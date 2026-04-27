import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { findSignerIndex } from "@/lib/aptos/multisig";
import { isAdmin } from "@/lib/auth/admin";
import { verifySessionToken } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { multisigs, proposals } from "@/lib/db/schema";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Verify session
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await verifySessionToken(authHeader.slice(7));

  const proposal = await db.query.proposals.findFirst({
    where: eq(proposals.id, id),
  });
  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  if (proposal.status === "submitted" || proposal.status === "cancelled") {
    return NextResponse.json(
      { error: `Proposal is already ${proposal.status}` },
      { status: 400 },
    );
  }

  const multisig = await db.query.multisigs.findFirst({
    where: eq(multisigs.id, proposal.multisigId),
  });
  if (!multisig) {
    return NextResponse.json({ error: "Multisig not found" }, { status: 500 });
  }

  // Authorize: caller must be a signer on this multisig OR an admin.
  // Re-check `isAdmin` against the current allowlist as a belt-and-braces
  // measure in case the env var changed since the JWT was issued.
  const publicKeys: string[] = JSON.parse(multisig.publicKeys);
  const callerIsSigner = findSignerIndex(publicKeys, session.publicKey) !== -1;
  const callerIsAdmin = Boolean(session.isAdmin) || isAdmin(session.publicKey);
  if (!callerIsSigner && !callerIsAdmin) {
    return NextResponse.json(
      {
        error:
          "Only a signer on this multisig or an admin can cancel this proposal.",
      },
      { status: 403 },
    );
  }

  await db
    .update(proposals)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(proposals.id, id));

  return NextResponse.json({ status: "cancelled" });
}
