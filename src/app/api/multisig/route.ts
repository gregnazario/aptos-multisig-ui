import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { deriveMultisigAddress } from "@/lib/aptos/multisig";
import { db } from "@/lib/db";
import { multisigs } from "@/lib/db/schema";

const VALID_NETWORKS = ["mainnet", "testnet", "devnet"] as const;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { publicKeys, threshold, network, label, expectedAddress } = body as {
    publicKeys?: string[];
    threshold?: number;
    network?: string;
    label?: string;
    expectedAddress?: string;
  };

  // Validate publicKeys
  if (
    !Array.isArray(publicKeys) ||
    publicKeys.length < 2 ||
    publicKeys.length > 32
  ) {
    return NextResponse.json(
      { error: "publicKeys must be an array of 2-32 hex strings" },
      { status: 400 },
    );
  }

  // Validate threshold
  if (
    typeof threshold !== "number" ||
    threshold < 1 ||
    threshold > publicKeys.length
  ) {
    return NextResponse.json(
      { error: `threshold must be between 1 and ${publicKeys.length}` },
      { status: 400 },
    );
  }

  // Validate network
  if (
    !network ||
    !VALID_NETWORKS.includes(network as (typeof VALID_NETWORKS)[number])
  ) {
    return NextResponse.json(
      { error: "network must be one of: mainnet, testnet, devnet" },
      { status: 400 },
    );
  }

  // Derive the multisig address
  let address: string;
  try {
    const result = deriveMultisigAddress(publicKeys, threshold);
    address = result.address;
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to derive address: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  // Verify expected address if provided
  if (
    expectedAddress &&
    expectedAddress.toLowerCase() !== address.toLowerCase()
  ) {
    return NextResponse.json(
      {
        error: "Derived address does not match expected address",
        derivedAddress: address,
        expectedAddress,
      },
      { status: 400 },
    );
  }

  // Check for existing registration
  const existing = await db.query.multisigs.findFirst({
    where: and(eq(multisigs.address, address), eq(multisigs.network, network)),
  });

  if (existing) {
    return NextResponse.json({
      ...existing,
      publicKeys: JSON.parse(existing.publicKeys),
    });
  }

  // Insert new record
  const id = uuid();
  const newRecord = {
    id,
    address,
    publicKeys: JSON.stringify(publicKeys),
    threshold,
    network,
    label: label ?? null,
  };

  await db.insert(multisigs).values(newRecord);

  return NextResponse.json(
    {
      ...newRecord,
      publicKeys,
      createdAt: new Date(),
    },
    { status: 201 },
  );
}
