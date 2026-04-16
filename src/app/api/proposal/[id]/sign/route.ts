import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { findSignerIndex } from "@/lib/aptos/multisig";
import { verifySessionToken } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { multisigs, proposals, signerResponses } from "@/lib/db/schema";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // 1. Verify JWT session
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing authorization header" },
      { status: 401 },
    );
  }

  let session;
  try {
    session = await verifySessionToken(authHeader.slice(7));
  } catch {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  // 2. Parse body
  const body = await request.json();
  const { signature } = body as { signature?: string };
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // 3. Fetch proposal (must be pending)
  const proposal = await db.query.proposals.findFirst({
    where: eq(proposals.id, id),
  });

  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  // 4. Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (proposal.expirationTimestampSecs < now) {
    await db
      .update(proposals)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(proposals.id, id));
    return NextResponse.json(
      { error: "Proposal has expired" },
      { status: 400 },
    );
  }

  if (proposal.status !== "pending") {
    return NextResponse.json(
      { error: `Proposal is ${proposal.status}, not pending` },
      { status: 400 },
    );
  }

  // 5. Fetch parent multisig and verify signer
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
  const signerIndex = findSignerIndex(publicKeys, session.publicKey);

  if (signerIndex < 0) {
    return NextResponse.json(
      { error: "You are not a signer on this multisig" },
      { status: 403 },
    );
  }

  // 6. Check no duplicate response
  const existing = await db.query.signerResponses.findFirst({
    where: and(
      eq(signerResponses.proposalId, id),
      eq(signerResponses.signerIndex, signerIndex),
    ),
  });

  if (existing) {
    return NextResponse.json(
      { error: "You have already responded to this proposal" },
      { status: 409 },
    );
  }

  // 7. Store signature
  await db.insert(signerResponses).values({
    id: uuid(),
    proposalId: id,
    signerIndex,
    publicKey: session.publicKey,
    response: "signed",
    signature,
  });

  // 8. Count signed responses and check threshold
  const allResponses = await db.query.signerResponses.findMany({
    where: eq(signerResponses.proposalId, id),
  });
  const signedCount = allResponses.filter(
    (r) => r.response === "signed",
  ).length;

  let status = proposal.status;
  if (signedCount >= multisig.threshold) {
    status = "ready";
    await db
      .update(proposals)
      .set({ status: "ready", updatedAt: new Date() })
      .where(eq(proposals.id, id));
  }

  return NextResponse.json({
    status,
    signedCount,
    threshold: multisig.threshold,
  });
}
