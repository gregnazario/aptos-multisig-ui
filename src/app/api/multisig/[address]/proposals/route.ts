import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { multisigs, proposals, signerResponses } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  const { searchParams } = new URL(request.url);
  const network = searchParams.get("network") ?? "mainnet";

  // Find the multisig by address + network
  const multisig = await db.query.multisigs.findFirst({
    where: and(eq(multisigs.address, address), eq(multisigs.network, network)),
  });

  if (!multisig) {
    return NextResponse.json(
      { error: "Multisig not found" },
      { status: 404 }
    );
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

      const signedCount = responses.filter((r) => r.response === "signed").length;
      const declinedCount = responses.filter((r) => r.response === "declined").length;

      return {
        ...proposal,
        payload: JSON.parse(proposal.payload),
        responses,
        signedCount,
        declinedCount,
      };
    })
  );

  return NextResponse.json(enrichedProposals);
}
