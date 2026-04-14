import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { multisigs } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  const { searchParams } = new URL(request.url);
  const network = searchParams.get("network") ?? "mainnet";

  const multisig = await db.query.multisigs.findFirst({
    where: and(eq(multisigs.address, address), eq(multisigs.network, network)),
  });

  if (!multisig) {
    return NextResponse.json(
      { error: "Multisig not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ...multisig,
    publicKeys: JSON.parse(multisig.publicKeys),
  });
}
