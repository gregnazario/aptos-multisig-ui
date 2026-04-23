import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { normalizeProposalPayload } from "@/lib/aptos/payload";
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

  return NextResponse.json({
    ...proposal,
    payload: normalizeProposalPayload(JSON.parse(proposal.payload)),
    multisig: {
      ...multisig,
      publicKeys: JSON.parse(multisig.publicKeys),
    },
    responses,
  });
}
