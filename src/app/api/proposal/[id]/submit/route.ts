import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, signerResponses, multisigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { deriveMultisigAddress, combineSignatures } from "@/lib/aptos/multisig";
import { submitMultisigTransaction } from "@/lib/aptos/transaction";
import type { AptosNetwork } from "@/lib/aptos/client";
import { getGasStationConfig, signAsFeePayer } from "@/lib/gas-station";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 1. Fetch proposal (must be status "ready")
  const proposal = await db.query.proposals.findFirst({
    where: eq(proposals.id, id),
  });

  if (!proposal) {
    return NextResponse.json(
      { error: "Proposal not found" },
      { status: 404 }
    );
  }

  if (proposal.status !== "ready") {
    return NextResponse.json(
      { error: `Proposal is ${proposal.status}, not ready for submission` },
      { status: 400 }
    );
  }

  // 2. Fetch parent multisig
  const multisig = await db.query.multisigs.findFirst({
    where: eq(multisigs.id, proposal.multisigId),
  });

  if (!multisig) {
    return NextResponse.json(
      { error: "Associated multisig not found" },
      { status: 404 }
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
        const feePayerSignature = signAsFeePayer(
          proposal.rawTransactionBytes
        );
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
    (r) => r.response === "signed" && r.signature !== null
  );

  if (signedResponses.length < multisig.threshold) {
    return NextResponse.json(
      { error: "Not enough signatures to meet threshold" },
      { status: 400 }
    );
  }

  // 4. Combine signatures into MultiEd25519Signature
  const multiSignature = combineSignatures(
    signedResponses.map((r) => ({
      signerIndex: r.signerIndex,
      signature: r.signature!,
    }))
  );

  // 5. Derive the MultiEd25519PublicKey
  const publicKeys: string[] = JSON.parse(multisig.publicKeys);
  const { multiPublicKey } = deriveMultisigAddress(
    publicKeys,
    multisig.threshold
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
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(proposals.id, id));

    return NextResponse.json(
      { error: message, status: "failed" },
      { status: 500 }
    );
  }
}
