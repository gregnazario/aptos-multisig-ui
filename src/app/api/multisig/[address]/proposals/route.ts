import { Ed25519PublicKey, Ed25519Signature } from "@aptos-labs/ts-sdk";
import { and, desc, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import type { AptosNetwork } from "@/lib/aptos/client";
import { findSignerIndex } from "@/lib/aptos/multisig";
import { normalizeProposalPayload } from "@/lib/aptos/payload";
import { buildTransaction } from "@/lib/aptos/transaction";
import { isAdmin } from "@/lib/auth/admin";
import { buildProposalProofCanonicalString } from "@/lib/auth/proposal-proof";
import { db } from "@/lib/db";
import { multisigs, proposals, signerResponses } from "@/lib/db/schema";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  const { searchParams } = new URL(request.url);
  const network = searchParams.get("network") ?? "mainnet";

  // Find the multisig by address + network
  const multisig = await db.query.multisigs.findFirst({
    where: and(eq(multisigs.address, address), eq(multisigs.network, network)),
  });

  if (!multisig) {
    return NextResponse.json({ error: "Multisig not found" }, { status: 404 });
  }

  // Fetch all proposals for this multisig, ordered by createdAt desc
  const allProposals = await db.query.proposals.findMany({
    where: eq(proposals.multisigId, multisig.id),
    orderBy: [desc(proposals.createdAt)],
  });

  // Enrich each proposal with signer responses and counts
  const enrichedProposals = await Promise.all(
    allProposals.map(async (proposal) => {
      const responses = await db.query.signerResponses.findMany({
        where: eq(signerResponses.proposalId, proposal.id),
      });

      const signedCount = responses.filter(
        (r) => r.response === "signed",
      ).length;
      const declinedCount = responses.filter(
        (r) => r.response === "declined",
      ).length;

      return {
        ...proposal,
        payload: normalizeProposalPayload(JSON.parse(proposal.payload)),
        responses,
        signedCount,
        declinedCount,
      };
    }),
  );

  return NextResponse.json(enrichedProposals);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;

  const body = await request.json();
  const {
    network,
    description,
    payload,
    maxGasAmount,
    gasUnitPrice,
    expirationSeconds,
    expirationTimestampSecs,
    sequenceNumber,
    feePayerAddress,
    source,
    sourceDappUrl,
    signature,
    creatorPublicKey,
    creatorSignature,
    creatorFullMessage,
  } = body;

  if (!network || !description || !payload) {
    return NextResponse.json(
      { error: "Missing required fields: network, description, payload" },
      { status: 400 },
    );
  }

  if (!creatorPublicKey || !creatorSignature || !creatorFullMessage) {
    return NextResponse.json(
      { error: "Creator proof required" },
      { status: 400 },
    );
  }

  // Look up multisig by address + network
  const multisig = await db.query.multisigs.findFirst({
    where: and(eq(multisigs.address, address), eq(multisigs.network, network)),
  });

  if (!multisig) {
    return NextResponse.json({ error: "Multisig not found" }, { status: 404 });
  }

  // Rebuild the transaction with the same parameters the client used to
  // build the bytes they signed. We pin `accountSequenceNumber` and
  // `expirationTimestampSecs` so the rebuild is byte-deterministic — without
  // that, the SDK would re-fetch the on-chain sequence number and derive a
  // fresh `expireTimestamp` from `Date.now()`, producing different bytes
  // than the client signed and breaking the creator-proof check.
  //
  // If the client lies about any field (payload, gas, fee payer, etc.) the
  // rebuilt bytes will diverge from the signed bytes and the canonical-hash
  // check below will reject the request.
  if (sequenceNumber === undefined || expirationTimestampSecs === undefined) {
    return NextResponse.json(
      {
        error:
          "Missing sequenceNumber or expirationTimestampSecs (required to verify creator proof).",
      },
      { status: 400 },
    );
  }
  let built;
  try {
    built = await buildTransaction({
      multisigAddress: address,
      payload,
      maxGasAmount,
      gasUnitPrice,
      expirationSeconds,
      feePayerAddress,
      network: network as AptosNetwork,
      accountSequenceNumber: sequenceNumber,
      expirationTimestampSecs,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Transaction build failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Verify the Ed25519 signature over the wallet-wrapped fullMessage, then
  // confirm that fullMessage embeds our canonical proof string derived from
  // the just-built rawTransactionBytes (binds the proof to this exact tx).
  let proofValid = false;
  let canonicalEmbedded = false;
  try {
    const rawTx = Uint8Array.from(
      (built.rawTransactionBytes.replace(/^0x/, "").match(/.{1,2}/g) ?? []).map(
        (b: string) => parseInt(b, 16),
      ),
    );
    const canonical = await buildProposalProofCanonicalString(rawTx);
    const messageBytes = new TextEncoder().encode(creatorFullMessage);
    const pubKey = new Ed25519PublicKey(creatorPublicKey);
    const sig = new Ed25519Signature(creatorSignature);
    proofValid = pubKey.verifySignature({
      message: messageBytes,
      signature: sig,
    });
    canonicalEmbedded = creatorFullMessage.includes(canonical);
  } catch {
    return NextResponse.json(
      { error: "Invalid proof encoding" },
      { status: 400 },
    );
  }
  if (!proofValid || !canonicalEmbedded) {
    return NextResponse.json(
      { error: "Creator proof did not verify" },
      { status: 403 },
    );
  }

  // Authorize: creator must be a multisig signer or in the admin allowlist.
  const publicKeys: string[] = JSON.parse(multisig.publicKeys);
  const signerIndex = findSignerIndex(publicKeys, creatorPublicKey);
  const creatorIsSigner = signerIndex !== -1;
  const creatorIsAdmin = !creatorIsSigner && isAdmin(creatorPublicKey);
  if (!creatorIsSigner && !creatorIsAdmin) {
    return NextResponse.json(
      { error: "Creator not authorized for this multisig" },
      { status: 403 },
    );
  }

  // Create proposal record
  const id = uuid();
  await db.insert(proposals).values({
    id,
    multisigId: multisig.id,
    description,
    source: source ?? "manual",
    sourceDappUrl: sourceDappUrl ?? null,
    payload: JSON.stringify(payload),
    rawTransactionBytes: built.rawTransactionBytes,
    sequenceNumber: built.sequenceNumber,
    maxGasAmount: built.maxGasAmount,
    gasUnitPrice: built.gasUnitPrice,
    expirationTimestampSecs: built.expirationTimestampSecs,
    feePayerAddress: feePayerAddress ?? null,
    status: "pending",
    createdBy: creatorPublicKey,
    creatorPublicKey,
    creatorSignature,
    creatorFullMessage,
  });

  // If an additional signer-vote signature is included and the creator IS a
  // signer, store it as their first approval.
  if (signature && creatorIsSigner) {
    await db.insert(signerResponses).values({
      id: uuid(),
      proposalId: id,
      signerIndex,
      publicKey: creatorPublicKey,
      response: "signed",
      signature,
    });
  }

  return NextResponse.json({ id, url: `/tx/${id}` }, { status: 201 });
}
