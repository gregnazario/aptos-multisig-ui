import { Badge } from "@/components/ui/badge";

export interface BalanceChange {
  address: string;
  asset: string;
  amount: string;
  kind: "coin" | "fa";
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

function assetLabel(asset: string): string {
  if (APT_ASSETS.has(asset) || APT_ASSETS.has(asset.toLowerCase()))
    return "APT";
  // Coin<T>: show trailing type name
  const generic = asset.match(/::([^:<>]+)>?$/);
  if (generic) return generic[1];
  return shortAddr(asset);
}

function formatAmount(amount: string, asset: string): string {
  const isApt = APT_ASSETS.has(asset) || APT_ASSETS.has(asset.toLowerCase());
  const negative = amount.startsWith("-");
  const raw = negative ? amount.slice(1) : amount;
  if (!isApt) return (negative ? "-" : "") + raw;
  // Format with 8 decimals for APT
  const padded = raw.padStart(9, "0");
  const whole = padded.slice(0, -8).replace(/^0+(?=\d)/, "");
  const frac = padded.slice(-8).replace(/0+$/, "");
  const body = frac ? `${whole}.${frac}` : whole;
  return (negative ? "-" : "") + body;
}

export function BalanceChanges({ changes }: { changes: BalanceChange[] }) {
  if (changes.length === 0) return null;

  // Sort: biggest absolute change first, decreases before increases at same magnitude
  const sorted = [...changes].sort((a, b) => {
    const absA = a.amount.startsWith("-") ? a.amount.slice(1) : a.amount;
    const absB = b.amount.startsWith("-") ? b.amount.slice(1) : b.amount;
    if (absA.length !== absB.length) return absB.length - absA.length;
    return absB.localeCompare(absA);
  });

  return (
    <div className="space-y-2">
      <p className="font-medium text-sm">Balance Changes ({sorted.length})</p>
      <div className="rounded-md border divide-y">
        {sorted.map((c, i) => {
          const negative = c.amount.startsWith("-");
          const display = formatAmount(c.amount, c.asset);
          return (
            <div
              key={`${c.address}-${c.asset}-${i}`}
              className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Badge
                  variant="outline"
                  className="text-[10px] shrink-0"
                  title={c.kind === "fa" ? "Fungible Asset" : "Coin"}
                >
                  {c.kind === "fa" ? "FA" : "Coin"}
                </Badge>
                <code
                  className="font-mono truncate text-muted-foreground"
                  title={c.address}
                >
                  {shortAddr(c.address)}
                </code>
              </div>
              <div className="flex items-center gap-2 shrink-0">
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
                  className="text-muted-foreground font-mono"
                  title={c.asset}
                >
                  {assetLabel(c.asset)}
                </code>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
