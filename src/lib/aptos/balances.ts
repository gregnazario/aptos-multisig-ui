/**
 * Helpers for indexer-backed account coin / FA balances and transfer propose URLs.
 */

export interface AccountAssetBalance {
  /** Coin type tag or FA metadata object address. */
  asset: string;
  /** Base units as a decimal string (no scientific notation). */
  amount: string;
  kind: "coin" | "fa";
  symbol?: string;
  name?: string;
  decimals?: number;
  isFrozen?: boolean;
  isPrimary?: boolean;
}

/** Raw shape returned by `Aptos.getAccountCoinsData` (subset we care about). */
export interface IndexerCoinBalanceRow {
  amount?: unknown;
  asset_type?: string | null;
  is_frozen?: boolean;
  is_primary?: boolean | null;
  token_standard?: string | null;
  metadata?: {
    symbol?: string | null;
    name?: string | null;
    decimals?: number | null;
    token_standard?: string | null;
  } | null;
}

function amountToString(amount: unknown): string {
  if (typeof amount === "bigint") return amount.toString();
  if (typeof amount === "number" && Number.isFinite(amount)) {
    return Math.trunc(amount).toString();
  }
  if (typeof amount === "string" && amount.length > 0) {
    // Indexer may return numeric strings; reject non-integer forms.
    if (/^-?\d+$/.test(amount)) return amount;
  }
  return "0";
}

function isPositiveAmount(amount: string): boolean {
  if (amount.startsWith("-")) return false;
  return amount !== "0" && /^[0-9]+$/.test(amount);
}

/**
 * Classify an indexer balance row as legacy coin (v1) or fungible asset (v2).
 */
export function classifyAssetKind(
  row: Pick<
    IndexerCoinBalanceRow,
    "token_standard" | "asset_type" | "metadata"
  >,
): "coin" | "fa" {
  const standard =
    row.token_standard ?? row.metadata?.token_standard ?? undefined;
  if (standard === "v1") return "coin";
  if (standard === "v2") return "fa";
  const asset = row.asset_type ?? "";
  return asset.includes("::") ? "coin" : "fa";
}

/**
 * Map indexer `current_fungible_asset_balances` rows into UI balances.
 * Drops zero/invalid amounts and rows without an asset type.
 */
export function mapIndexerCoinBalances(
  rows: IndexerCoinBalanceRow[],
): AccountAssetBalance[] {
  const out: AccountAssetBalance[] = [];
  for (const row of rows) {
    const asset = row.asset_type?.trim();
    if (!asset) continue;
    const amount = amountToString(row.amount);
    if (!isPositiveAmount(amount)) continue;

    const kind = classifyAssetKind(row);
    const decimals =
      typeof row.metadata?.decimals === "number"
        ? row.metadata.decimals
        : undefined;
    const symbol = row.metadata?.symbol ?? undefined;
    const name = row.metadata?.name ?? undefined;

    out.push({
      asset,
      amount,
      kind,
      symbol: symbol || undefined,
      name: name || undefined,
      decimals,
      isFrozen: row.is_frozen,
      isPrimary: row.is_primary ?? undefined,
    });
  }
  return out;
}

/**
 * Format base-unit amount for display using asset decimals.
 */
export function formatAssetAmount(
  amount: string,
  decimals: number | undefined | null,
): string {
  const negative = amount.startsWith("-");
  const raw = negative ? amount.slice(1) : amount;
  if (decimals == null || decimals === 0) {
    const grouped = Number.isFinite(Number(raw))
      ? Number(raw).toLocaleString()
      : raw;
    return (negative ? "-" : "") + grouped;
  }
  const padded = raw.padStart(decimals + 1, "0");
  const wholeRaw = padded.slice(0, -decimals).replace(/^0+(?=\d)/, "");
  const fracRaw = padded.slice(-decimals).replace(/0+$/, "");
  const wholeFormatted = Number(wholeRaw || "0").toLocaleString();
  const body = fracRaw ? `${wholeFormatted}.${fracRaw}` : wholeFormatted;
  return (negative ? "-" : "") + body;
}

export function shortAssetLabel(asset: string): string {
  if (asset.includes("::")) {
    const parts = asset.split("::");
    return parts[parts.length - 1] ?? asset;
  }
  const cleaned = asset.replace(/^0x/, "");
  if (cleaned.length <= 12)
    return asset.startsWith("0x") ? asset : `0x${cleaned}`;
  return `0x${cleaned.slice(0, 6)}…${cleaned.slice(-4)}`;
}

/**
 * Build a propose-page URL that prefills the correct transfer entry function
 * for this asset. Recipient and amount are left for the user to fill in.
 */
export function buildTransferProposeHref(opts: {
  multisigAddress: string;
  network: string;
  balance: AccountAssetBalance;
}): string {
  const { multisigAddress, network, balance } = opts;
  const params = new URLSearchParams({ network });

  if (balance.kind === "coin") {
    params.set("module", "0x1");
    params.set("name", "aptos_account");
    params.set("function", "transfer_coins");
    params.set("type_args", balance.asset);
    params.set(
      "desc",
      `Transfer ${balance.symbol ?? shortAssetLabel(balance.asset)}`,
    );
  } else {
    params.set("module", "0x1");
    params.set("name", "primary_fungible_store");
    params.set("function", "transfer");
    params.set("type_args", "0x1::fungible_asset::Metadata");
    // First ABI arg is the metadata object address; recipient/amount stay empty.
    params.set("args", balance.asset);
    params.set(
      "desc",
      `Transfer ${balance.symbol ?? shortAssetLabel(balance.asset)}`,
    );
  }

  return `/multisig/${encodeURIComponent(multisigAddress)}/propose?${params.toString()}`;
}
