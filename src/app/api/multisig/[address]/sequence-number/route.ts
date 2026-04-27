import { type NextRequest, NextResponse } from "next/server";
import { type AptosNetwork, getAptosClient } from "@/lib/aptos/client";

/**
 * GET /api/multisig/[address]/sequence-number?network=...
 *
 * Returns the multisig account's current on-chain sequence number — the
 * value that would be used for the next transaction submitted directly to
 * chain. The proposal builder uses this to suggest the next slot when
 * queueing multiple proposals (each proposal must use a distinct sequence
 * number; otherwise only the first to land on chain succeeds).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  const { searchParams } = new URL(request.url);
  const network = (searchParams.get("network") ?? "mainnet") as AptosNetwork;

  try {
    const aptos = getAptosClient(network);
    const account = await aptos.getAccountInfo({ accountAddress: address });
    return NextResponse.json({
      sequenceNumber: Number(account.sequence_number),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch sequence number";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
