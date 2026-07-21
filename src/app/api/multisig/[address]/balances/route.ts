import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import {
  type IndexerCoinBalanceRow,
  mapIndexerCoinBalances,
} from "@/lib/aptos/balances";
import { type AptosNetwork, getAptosClient } from "@/lib/aptos/client";
import { db } from "@/lib/db";
import { multisigs } from "@/lib/db/schema";

const VALID_NETWORKS = ["mainnet", "testnet", "devnet"] as const;

interface Props {
  params: Promise<{ address: string }>;
}

/**
 * GET /api/multisig/[address]/balances?network=<net>
 *
 * Returns non-zero coin and fungible-asset balances for a registered multisig,
 * sourced from the Aptos indexer via `getAccountCoinsData`.
 */
export async function GET(request: NextRequest, { params }: Props) {
  const { address } = await params;
  const network = (request.nextUrl.searchParams.get("network") ??
    "mainnet") as AptosNetwork;

  if (!VALID_NETWORKS.includes(network)) {
    return NextResponse.json(
      { error: "network must be one of: mainnet, testnet, devnet" },
      { status: 400 },
    );
  }

  const multisig = await db.query.multisigs.findFirst({
    where: and(eq(multisigs.address, address), eq(multisigs.network, network)),
  });

  if (!multisig) {
    return NextResponse.json({ error: "Multisig not found" }, { status: 404 });
  }

  const aptos = getAptosClient(network);

  try {
    const rows = (await aptos.getAccountCoinsData({
      accountAddress: multisig.address,
      options: {
        where: { amount: { _gt: 0 } },
        limit: 100,
        orderBy: [{ amount: "desc" }],
      },
    })) as IndexerCoinBalanceRow[];

    const balances = mapIndexerCoinBalances(rows);

    return NextResponse.json({
      address: multisig.address,
      network,
      balances,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to fetch balances from indexer: ${(err as Error).message}`,
      },
      { status: 502 },
    );
  }
}
