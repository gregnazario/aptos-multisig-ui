"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type AccountAssetBalance,
  buildTransferProposeHref,
  formatAssetAmount,
  shortAssetLabel,
} from "@/lib/aptos/balances";
import type { AptosNetwork } from "@/lib/aptos/client";
import { cn } from "@/lib/utils";

interface AccountBalancesProps {
  address: string;
  network: AptosNetwork;
}

export function AccountBalances({ address, network }: AccountBalancesProps) {
  const [balances, setBalances] = useState<AccountAssetBalance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(
      `/api/multisig/${encodeURIComponent(address)}/balances?network=${network}`,
    )
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error ?? "Failed to load balances");
        }
        return data as { balances: AccountAssetBalance[] };
      })
      .then((data) => {
        if (!cancelled) {
          setBalances(data.balances);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setBalances(null);
          setError(
            err instanceof Error ? err.message : "Failed to load balances",
          );
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [address, network]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Balances</CardTitle>
        <CardDescription>
          Coins and fungible assets held by this multisig (from the indexer).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading && (
          <p className="text-sm text-muted-foreground">Loading balances…</p>
        )}
        {!loading && error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
        {!loading && !error && balances && balances.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No asset balances found.
          </p>
        )}
        {!loading && !error && balances && balances.length > 0 && (
          <div className="rounded-md border divide-y">
            {balances.map((b) => {
              const label = b.symbol ?? shortAssetLabel(b.asset);
              const display = formatAssetAmount(b.amount, b.decimals);
              const transferHref = buildTransferProposeHref({
                multisigAddress: address,
                network,
                balance: b,
              });
              return (
                <div
                  key={`${b.kind}-${b.asset}`}
                  className="flex items-center justify-between gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-sm truncate">
                        {label}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[10px] shrink-0"
                        title={b.kind === "fa" ? "Fungible Asset" : "Coin"}
                      >
                        {b.kind === "fa" ? "FA" : "Coin"}
                      </Badge>
                      {b.isFrozen && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] shrink-0"
                        >
                          frozen
                        </Badge>
                      )}
                    </div>
                    <code
                      className="block text-[10px] text-muted-foreground font-mono truncate"
                      title={b.name ? `${b.name} — ${b.asset}` : b.asset}
                    >
                      {b.asset}
                    </code>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono text-sm tabular-nums">
                      {display}
                    </span>
                    <Link
                      href={transferHref}
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" }),
                      )}
                    >
                      Transfer
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
