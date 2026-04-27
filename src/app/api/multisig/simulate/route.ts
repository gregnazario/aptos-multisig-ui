import { type NextRequest, NextResponse } from "next/server";
import { getAssetMetadataMap } from "@/lib/aptos/asset-metadata";
import { type AptosNetwork, getAptosClient } from "@/lib/aptos/client";

interface BalanceChange {
  /** Owner address — either derived from a CoinDeposit/Withdraw event, or from a FungibleStore's `owner` field */
  address: string;
  /** Asset identifier: coin type (e.g. `0x1::aptos_coin::AptosCoin`) or FA metadata object address */
  asset: string;
  /** Net delta as a signed decimal string of base units; negative = decrease */
  amount: string;
  /** `coin` for legacy Coin<T>, `fa` for fungible asset */
  kind: "coin" | "fa";
  /** Resolved asset symbol (e.g. `APT`, `USDC`) when known */
  assetSymbol?: string;
  /** Resolved asset name (e.g. `Aptos Coin`) when known */
  assetName?: string;
  /** Number of decimal places for `amount` when known */
  assetDecimals?: number;
}

type SimEvent = { type: string; data: unknown };
type SimChange = {
  type: string;
  address?: string;
  data?: { type: string; data: unknown };
};

const normalize = (addr: string) =>
  addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");

function extractBalanceChanges(
  events: SimEvent[],
  changes: SimChange[],
): BalanceChange[] {
  // Map normalized FA store address -> { owner, metadata }
  const storeInfo = new Map<string, { owner: string; metadata: string }>();
  for (const c of changes) {
    if (
      c.type === "write_resource" &&
      c.data?.type === "0x1::fungible_asset::FungibleStore" &&
      c.address
    ) {
      const d = c.data.data as {
        owner?: string;
        metadata?: { inner?: string } | string;
      };
      const owner = d.owner;
      const metadata =
        typeof d.metadata === "string" ? d.metadata : d.metadata?.inner;
      if (owner && metadata) {
        storeInfo.set(normalize(c.address), { owner, metadata });
      }
    }
  }

  // Accumulate deltas keyed by `${address}|${asset}`
  const deltas = new Map<
    string,
    { address: string; asset: string; amount: bigint; kind: "coin" | "fa" }
  >();
  const bump = (
    address: string,
    asset: string,
    delta: bigint,
    kind: "coin" | "fa",
  ) => {
    const key = `${normalize(address)}|${asset.toLowerCase()}`;
    const cur = deltas.get(key);
    if (cur) cur.amount += delta;
    else deltas.set(key, { address, asset, amount: delta, kind });
  };

  for (const e of events) {
    const d = e.data as Record<string, unknown> | undefined;
    if (!d) continue;

    // Modern Coin events: 0x1::coin::CoinDeposit / CoinWithdraw
    if (e.type === "0x1::coin::CoinDeposit" && d.account && d.coin_type) {
      bump(
        String(d.account),
        String(d.coin_type),
        BigInt(String(d.amount ?? 0)),
        "coin",
      );
      continue;
    }
    if (e.type === "0x1::coin::CoinWithdraw" && d.account && d.coin_type) {
      bump(
        String(d.account),
        String(d.coin_type),
        -BigInt(String(d.amount ?? 0)),
        "coin",
      );
      continue;
    }

    // FA events: 0x1::fungible_asset::Deposit / Withdraw
    if (e.type === "0x1::fungible_asset::Deposit" && d.store) {
      const info = storeInfo.get(normalize(String(d.store)));
      if (info) {
        bump(info.owner, info.metadata, BigInt(String(d.amount ?? 0)), "fa");
      }
      continue;
    }
    if (e.type === "0x1::fungible_asset::Withdraw" && d.store) {
      const info = storeInfo.get(normalize(String(d.store)));
      if (info) {
        bump(info.owner, info.metadata, -BigInt(String(d.amount ?? 0)), "fa");
      }
    }
  }

  return Array.from(deltas.values())
    .filter((d) => d.amount !== 0n)
    .map((d) => ({
      address: d.address,
      asset: d.asset,
      amount: d.amount.toString(),
      kind: d.kind,
    }));
}

/**
 * POST /api/multisig/simulate
 *
 * Simulates a transaction for a multisig account and returns
 * the expected changes (gas used, events, state changes, balance deltas).
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { multisigAddress, network, payload, maxGasAmount, gasUnitPrice } =
    body;

  if (!multisigAddress || !network || !payload) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    );
  }

  const aptos = getAptosClient(network as AptosNetwork);

  try {
    // Use the view/simulate API to simulate the transaction
    const result = await aptos.transaction.simulate.simple({
      signerPublicKey: undefined as any, // Simulation doesn't need a real signer
      transaction: await aptos.transaction.build.simple({
        sender: multisigAddress,
        data: {
          function:
            `${payload.module}::${payload.function}` as `${string}::${string}::${string}`,
          typeArguments: payload.typeArgs ?? [],
          functionArguments: payload.args ?? [],
        },
        options: {
          maxGasAmount: maxGasAmount ?? 10000,
          gasUnitPrice: gasUnitPrice ?? 100,
        },
      }),
    });

    // Extract useful information from simulation result
    const txResult = result[0];
    if (!txResult) {
      return NextResponse.json(
        { error: "Empty simulation result" },
        { status: 500 },
      );
    }

    const rawEvents: SimEvent[] =
      (txResult as any).events?.map((e: any) => ({
        type: e.type,
        data: e.data,
      })) ?? [];
    const rawChanges: SimChange[] =
      (txResult as any).changes?.map((c: any) => ({
        type: c.type,
        address: c.address,
        data: c.data,
      })) ?? [];

    const balanceChanges = extractBalanceChanges(rawEvents, rawChanges);
    // Enrich with symbol/name/decimals so the UI can render `+1.234 USDC`
    // instead of `+1234000 0xabc…`. Best-effort: assets we can't resolve
    // pass through unchanged.
    const metadataMap = await getAssetMetadataMap(
      network as AptosNetwork,
      balanceChanges.map((b) => b.asset),
    );
    const enrichedBalanceChanges = balanceChanges.map((b) => {
      const meta = metadataMap[b.asset];
      return meta
        ? {
            ...b,
            assetSymbol: meta.symbol,
            assetName: meta.name,
            assetDecimals: meta.decimals,
          }
        : b;
    });

    return NextResponse.json({
      success: txResult.success,
      vmStatus: txResult.vm_status,
      gasUsed: txResult.gas_used,
      events: rawEvents,
      changes: rawChanges.map((c) => ({
        type: c.type,
        address: c.address,
        resource: c.data?.type,
      })),
      balanceChanges: enrichedBalanceChanges,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Simulation failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
