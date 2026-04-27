import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import type { AptosNetwork } from "@/lib/aptos/client";
import {
  combineSignatures,
  deriveMultisigAddress,
  findSignerIndex,
} from "@/lib/aptos/multisig";
import { submitMultisigTransaction } from "@/lib/aptos/transaction";
import { isAdmin } from "@/lib/auth/admin";
import { verifySessionToken } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { multisigs, proposals, signerResponses } from "@/lib/db/schema";
import { getGasStationConfig, signAsFeePayer } from "@/lib/gas-station";
import { stringify } from "@/lib/utils";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // 1. Verify session — submission must come from an authenticated wallet.
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      {
        error:
          "Authentication required. Connect your wallet to submit this proposal.",
      },
      { status: 401 },
    );
  }

  let session;
  try {
    session = await verifySessionToken(authHeader.slice(7));
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired session. Please reconnect your wallet." },
      { status: 401 },
    );
  }

  // 2. Fetch proposal (must be status "ready")
  const proposal = await db.query.proposals.findFirst({
    where: eq(proposals.id, id),
  });

  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  if (proposal.status !== "ready") {
    return NextResponse.json(
      { error: `Proposal is ${proposal.status}, not ready for submission` },
      { status: 400 },
    );
  }

  // 3. Fetch parent multisig
  const multisig = await db.query.multisigs.findFirst({
    where: eq(multisigs.id, proposal.multisigId),
  });

  if (!multisig) {
    return NextResponse.json(
      { error: "Associated multisig not found" },
      { status: 404 },
    );
  }

  // 3b. Authorize: caller must be a signer on this multisig OR an admin.
  // The session JWT's `isAdmin` flag is set at /api/verify time and bound to
  // the wallet's signed challenge, so we trust it here. We re-check `isAdmin`
  // against the current allowlist as a belt-and-braces measure in case the
  // env var changed since the token was issued.
  const publicKeys: string[] = JSON.parse(multisig.publicKeys);
  const callerIsSigner = findSignerIndex(publicKeys, session.publicKey) !== -1;
  const callerIsAdmin = Boolean(session.isAdmin) || isAdmin(session.publicKey);
  if (!callerIsSigner && !callerIsAdmin) {
    return NextResponse.json(
      {
        error:
          "Only a signer on this multisig or an admin can submit this proposal.",
      },
      { status: 403 },
    );
  }

  // 2b. Auto-sponsor: if proposal has a feePayerAddress but no feePayerSignature,
  // and the gas station is enabled and its address matches, auto-sign as fee payer.
  if (proposal.feePayerAddress && !proposal.feePayerSignature) {
    const gasConfig = getGasStationConfig();
    if (
      gasConfig.enabled &&
      gasConfig.address?.toLowerCase() ===
        proposal.feePayerAddress.toLowerCase() &&
      gasConfig.networks.includes(multisig.network as AptosNetwork)
    ) {
      try {
        const feePayerSignature = signAsFeePayer(proposal.rawTransactionBytes);
        await db
          .update(proposals)
          .set({ feePayerSignature, updatedAt: new Date() })
          .where(eq(proposals.id, id));
        // Update local reference so it's available downstream if needed
        proposal.feePayerSignature = feePayerSignature;
      } catch {
        // Auto-sponsor failed; continue without it — manual sponsoring is still possible
      }
    }
  }

  // 3. Fetch all signer responses that are "signed"
  const allResponses = await db.query.signerResponses.findMany({
    where: eq(signerResponses.proposalId, id),
  });
  const signedResponses = allResponses.filter(
    (r) => r.response === "signed" && r.signature !== null,
  );

  if (signedResponses.length < multisig.threshold) {
    return NextResponse.json(
      { error: "Not enough signatures to meet threshold" },
      { status: 400 },
    );
  }

  // 4. Combine signatures into MultiEd25519Signature
  console.log("signedResponses", stringify(signedResponses));

  const multiSignature = combineSignatures(
    signedResponses.map((r) => ({
      signerIndex: r.signerIndex,
      signature: r.signature!,
    })),
  );

  // 5. Derive the MultiEd25519PublicKey
  const { multiPublicKey } = deriveMultisigAddress(
    publicKeys,
    multisig.threshold,
  );

  // 6. Submit to chain
  try {
    const txHash = await submitMultisigTransaction({
      rawTransactionBytes: proposal.rawTransactionBytes,
      multiPublicKey,
      multiSignature,
      network: multisig.network as AptosNetwork,
    });

    // 7. On success: update proposal status to "submitted", store txHash
    await db
      .update(proposals)
      .set({ status: "submitted", txHash, updatedAt: new Date() })
      .where(eq(proposals.id, id));

    return NextResponse.json({ txHash, status: "submitted" });
  } catch (err) {
    // 8. On failure: update proposal status to "failed"
    const message =
      err instanceof Error ? err.message : "Transaction submission failed";

    await db
      .update(proposals)
      .set({ status: "failed", failureReason: message, updatedAt: new Date() })
      .where(eq(proposals.id, id));

    return NextResponse.json(
      { error: message, status: "failed" },
      { status: 500 },
    );
  }
}
