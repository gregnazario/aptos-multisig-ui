import { NextRequest, NextResponse } from "next/server";
import { deriveMultisigAddress } from "@/lib/aptos/multisig";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { publicKeys, threshold } = body as {
    publicKeys?: string[];
    threshold?: number;
  };

  if (!Array.isArray(publicKeys) || publicKeys.length < 2 || publicKeys.length > 32) {
    return NextResponse.json(
      { error: "publicKeys must be an array of 2-32 hex strings" },
      { status: 400 }
    );
  }

  if (typeof threshold !== "number" || threshold < 1 || threshold > publicKeys.length) {
    return NextResponse.json(
      { error: `threshold must be between 1 and ${publicKeys.length}` },
      { status: 400 }
    );
  }

  try {
    const result = deriveMultisigAddress(publicKeys, threshold);
    return NextResponse.json({ address: result.address });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to derive address: ${(err as Error).message}` },
      { status: 400 }
    );
  }
}
