import { Badge } from "@/components/ui/badge";

export interface BalanceChange {
  address: string;
  asset: string;
  amount: string;
  kind: "coin" | "fa";
  assetSymbol?: string;
  assetName?: string;
  assetDecimals?: number;
}

const APT_ASSETS = new Set([
  "0x1::aptos_coin::AptosCoin",
  "0x000000000000000000000000000000000000000000000000000000000000000a",
  "0xa",
]);

function shortAddr(a: string) {
  const cleaned = a.replace(/^0x/, "");
  if (cleaned.length <= 12) return `0x${cleaned}`;
  return `0x${cleaned.slice(0, 6)}…${cleaned.slice(-4)}`;
}

function normalizeAddr(a: string): string {
  return a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function assetLabel(c: BalanceChange): string {
  if (c.assetSymbol) return c.assetSymbol;
  if (APT_ASSETS.has(c.asset) || APT_ASSETS.has(c.asset.toLowerCase()))
    return "APT";
  const generic = c.asset.match(/::([^:<>]+)>?$/);
  if (generic) return generic[1];
  return shortAddr(c.asset);
}

/**
 * Format `amount` (a signed decimal string of base units) using the
 * asset's decimals. Falls back to the raw integer string when decimals
 * are unknown so we never silently misrepresent an amount.
 */
function formatAmount(c: BalanceChange): string {
  const negative = c.amount.startsWith("-");
  const raw = negative ? c.amount.slice(1) : c.amount;
  const decimals =
    c.assetDecimals ??
    (APT_ASSETS.has(c.asset) || APT_ASSETS.has(c.asset.toLowerCase())
      ? 8
      : null);
  if (decimals === null || decimals === 0) {
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

export function BalanceChanges({
  changes,
  multisigAddress,
}: {
  changes: BalanceChange[];
  /** When supplied, rows for this address are tagged "this multisig". */
  multisigAddress?: string;
}) {
  if (changes.length === 0) return null;

  // Sort: biggest absolute base-unit change first.
  const sorted = [...changes].sort((a, b) => {
    const absA = a.amount.startsWith("-") ? a.amount.slice(1) : a.amount;
    const absB = b.amount.startsWith("-") ? b.amount.slice(1) : b.amount;
    if (absA.length !== absB.length) return absB.length - absA.length;
    return absB.localeCompare(absA);
  });

  const normalizedMultisig = multisigAddress
    ? normalizeAddr(multisigAddress)
    : null;

  return (
    <div className="space-y-2">
      <p className="font-medium text-sm">Balance Changes ({sorted.length})</p>
      <div className="rounded-md border divide-y">
        {sorted.map((c, i) => {
          const negative = c.amount.startsWith("-");
          const display = formatAmount(c);
          const symbolOrFallback = assetLabel(c);
          const isMultisig =
            normalizedMultisig !== null &&
            normalizeAddr(c.address) === normalizedMultisig;
          return (
            <div
              key={`${c.address}-${c.asset}-${i}`}
              className="flex flex-col gap-1.5 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="shrink-0 text-[10px]"
                  title={c.kind === "fa" ? "Fungible Asset" : "Coin"}
                >
                  {c.kind === "fa" ? "FA" : "Coin"}
                </Badge>
                <code
                  className="truncate font-mono text-muted-foreground"
                  title={c.address}
                >
                  {shortAddr(c.address)}
                </code>
                {isMultisig && (
                  <Badge
                    variant="secondary"
                    className="shrink-0 text-[10px]"
                    title="This multisig account"
                  >
                    this multisig
                  </Badge>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={
                    "font-mono font-medium tabular-nums " +
                    (negative ? "text-red-600" : "text-green-600")
                  }
                >
                  {negative ? "" : "+"}
                  {display}
                </span>
                <code
                  className="font-mono text-muted-foreground"
                  title={c.assetName ?? c.asset}
                >
                  {symbolOrFallback}
                </code>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
