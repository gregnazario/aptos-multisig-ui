import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { findSignerIndex } from "@/lib/aptos/multisig";
import { normalizeProposalPayload } from "@/lib/aptos/payload";
import { deriveAddressFromPublicKey, isAdmin } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { multisigs, proposals, signerResponses } from "@/lib/db/schema";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const proposal = await db.query.proposals.findFirst({
    where: eq(proposals.id, id),
  });

  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  const multisig = await db.query.multisigs.findFirst({
    where: eq(multisigs.id, proposal.multisigId),
  });

  if (!multisig) {
    return NextResponse.json(
      { error: "Associated multisig not found" },
      { status: 404 },
    );
  }

  const responses = await db.query.signerResponses.findMany({
    where: eq(signerResponses.proposalId, id),
  });

  const multisigPublicKeys: string[] = JSON.parse(multisig.publicKeys);

  // Derive creator identity + role for the UI. Legacy rows with no stored
  // proof show up as "unverified" and get no address.
  let creatorAddress: string | null = null;
  let creatorRole: "signer" | "admin" | "unverified" = "unverified";
  if (proposal.creatorPublicKey) {
    try {
      creatorAddress = `0x${deriveAddressFromPublicKey(proposal.creatorPublicKey)}`;
    } catch {
      creatorAddress = null;
    }
    if (findSignerIndex(multisigPublicKeys, proposal.creatorPublicKey) !== -1) {
      creatorRole = "signer";
    } else if (isAdmin(proposal.creatorPublicKey)) {
      creatorRole = "admin";
    }
  }

  return NextResponse.json({
    ...proposal,
    payload: normalizeProposalPayload(JSON.parse(proposal.payload)),
    multisig: {
      ...multisig,
      publicKeys: multisigPublicKeys,
    },
    responses,
    creatorAddress,
    creatorRole,
  });
}
