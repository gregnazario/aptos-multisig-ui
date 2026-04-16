import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { multisigSetups, setupVerifications } from "@/lib/db/schema";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const setup = await db.query.multisigSetups.findFirst({
    where: eq(multisigSetups.id, id),
  });

  if (!setup) {
    return NextResponse.json({ error: "Setup not found" }, { status: 404 });
  }

  const verifications = await db.query.setupVerifications.findMany({
    where: eq(setupVerifications.setupId, id),
  });

  return NextResponse.json({
    ...setup,
    addresses: JSON.parse(setup.addresses),
    verifications: verifications.map((v) => ({
      address: v.address,
      publicKey: v.publicKey,
      verifiedAt: v.verifiedAt,
    })),
  });
}
