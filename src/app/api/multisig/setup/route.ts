import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { multisigSetups } from "@/lib/db/schema";
import { v4 as uuid } from "uuid";

const VALID_NETWORKS = ["mainnet", "testnet", "devnet"] as const;
const ADDRESS_REGEX = /^0x[0-9a-fA-F]{64}$/;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { addresses, threshold, network, label, createdBy } = body as {
    addresses?: string[];
    threshold?: number;
    network?: string;
    label?: string;
    createdBy?: string;
  };

  // Validate addresses
  if (!Array.isArray(addresses) || addresses.length < 2 || addresses.length > 32) {
    return NextResponse.json(
      { error: "addresses must be an array of 2-32 Aptos addresses" },
      { status: 400 }
    );
  }

  for (const addr of addresses) {
    if (!ADDRESS_REGEX.test(addr)) {
      return NextResponse.json(
        { error: `Invalid Aptos address: ${addr}` },
        { status: 400 }
      );
    }
  }

  // Check for duplicates
  const uniqueAddresses = new Set(addresses.map((a) => a.toLowerCase()));
  if (uniqueAddresses.size !== addresses.length) {
    return NextResponse.json(
      { error: "Duplicate addresses are not allowed" },
      { status: 400 }
    );
  }

  // Validate threshold
  if (typeof threshold !== "number" || threshold < 1 || threshold > addresses.length) {
    return NextResponse.json(
      { error: `threshold must be between 1 and ${addresses.length}` },
      { status: 400 }
    );
  }

  // Validate network
  if (!network || !VALID_NETWORKS.includes(network as (typeof VALID_NETWORKS)[number])) {
    return NextResponse.json(
      { error: "network must be one of: mainnet, testnet, devnet" },
      { status: 400 }
    );
  }

  // Validate createdBy
  if (!createdBy || !ADDRESS_REGEX.test(createdBy)) {
    return NextResponse.json(
      { error: "createdBy must be a valid Aptos address" },
      { status: 400 }
    );
  }

  // createdBy must be in the addresses list
  if (!addresses.some((a) => a.toLowerCase() === createdBy.toLowerCase())) {
    return NextResponse.json(
      { error: "createdBy address must be in the addresses list" },
      { status: 400 }
    );
  }

  const id = uuid();
  await db.insert(multisigSetups).values({
    id,
    addresses: JSON.stringify(addresses),
    threshold,
    network,
    label: label ?? null,
    createdBy,
    status: "pending",
  });

  return NextResponse.json(
    { id, url: `/multisig/setup/${id}` },
    { status: 201 }
  );
}
