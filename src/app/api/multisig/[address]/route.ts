import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { verifySigner } from "@/lib/auth/verify-signer";
import { db } from "@/lib/db";
import { multisigs } from "@/lib/db/schema";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  const { searchParams } = new URL(request.url);
  const network = searchParams.get("network") ?? "mainnet";

  const multisig = await db.query.multisigs.findFirst({
    where: and(eq(multisigs.address, address), eq(multisigs.network, network)),
  });

  if (!multisig) {
    return NextResponse.json({ error: "Multisig not found" }, { status: 404 });
  }

  const publicKeys: string[] = JSON.parse(multisig.publicKeys);

  // Only signers can view multisig details
  const auth = await verifySigner(
    request.headers.get("authorization"),
    publicKeys,
  );
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    ...multisig,
    publicKeys,
  });
}
