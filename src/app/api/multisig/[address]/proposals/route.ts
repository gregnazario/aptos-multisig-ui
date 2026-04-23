import { and, desc, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import type { AptosNetwork } from "@/lib/aptos/client";
import { findSignerIndex } from "@/lib/aptos/multisig";
import { normalizeProposalPayload } from "@/lib/aptos/payload";
import { buildTransaction } from "@/lib/aptos/transaction";
import { verifySessionToken } from "@/lib/auth/session";
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

  // Verify JWT session
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing or invalid Authorization header" },
      { status: 401 },
    );
  }

  let session;
  try {
    session = await verifySessionToken(authHeader.slice(7));
  } catch {
    return NextResponse.json(
      { error: "Invalid session token" },
      { status: 401 },
    );
  }

  const body = await request.json();
  const {
    network,
    description,
    payload,
    maxGasAmount,
    gasUnitPrice,
    expirationSeconds,
    feePayerAddress,
    source,
    sourceDappUrl,
    signature,
  } = body;

  if (!network || !description || !payload) {
    return NextResponse.json(
      { error: "Missing required fields: network, description, payload" },
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

  // Verify session's publicKey is in the multisig's signer list
  const publicKeys: string[] = JSON.parse(multisig.publicKeys);
  const signerIndex = findSignerIndex(publicKeys, session.publicKey);
  if (signerIndex === -1) {
    return NextResponse.json(
      { error: "You are not a signer of this multisig" },
      { status: 403 },
    );
  }

  // Build the transaction
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
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Transaction build failed";
    return NextResponse.json({ error: message }, { status: 400 });
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
    createdBy: session.publicKey,
  });

  // If signature is provided, store the proposer's signature
  if (signature) {
    await db.insert(signerResponses).values({
      id: uuid(),
      proposalId: id,
      signerIndex,
      publicKey: session.publicKey,
      response: "signed",
      signature,
    });
  }

  return NextResponse.json({ id, url: `/tx/${id}` }, { status: 201 });
}
