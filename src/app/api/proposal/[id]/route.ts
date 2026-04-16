import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { verifySigner } from "@/lib/auth/verify-signer";
import { db } from "@/lib/db";
import { multisigs, proposals, signerResponses } from "@/lib/db/schema";

export async function GET(
  request: NextRequest,
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

  const publicKeys: string[] = JSON.parse(multisig.publicKeys);

  // Only signers can view proposal details
  const auth = await verifySigner(
    request.headers.get("authorization"),
    publicKeys,
  );
  if (!auth.ok) return auth.response;

  const responses = await db.query.signerResponses.findMany({
    where: eq(signerResponses.proposalId, id),
  });

  return NextResponse.json({
    ...proposal,
    payload: JSON.parse(proposal.payload),
    multisig: {
      ...multisig,
      publicKeys,
    },
    responses,
  });
}
