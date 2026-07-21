"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useWallet } from "@/components/wallet-provider";
import { cn } from "@/lib/utils";

interface ProposalCounts {
  pending: number;
  ready: number;
  submitted: number;
  expired: number;
  failed: number;
}

interface AdminMultisig {
  id: string;
  address: string;
  label: string | null;
  threshold: number;
  signerCount: number;
  network: string;
  proposalCounts: ProposalCounts;
  balanceApt: number | null;
  sequenceNumber: number | null;
  onChain: "ok" | "unavailable";
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; multisigs: AdminMultisig[] };

export default function AdminPage() {
  const { connected, isAdmin, network, verifyIdentity } = useWallet();
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      // Prompts a wallet signature on first call (cached thereafter). Kept
      // behind an explicit user action so the wallet popup isn't triggered
      // on page load.
      const token = await verifyIdentity();
      const res = await fetch(`/api/admin/multisigs?network=${network}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setState({
          kind: "error",
          message: data.error ?? `Request failed (${res.status})`,
        });
        return;
      }
      setState({ kind: "loaded", multisigs: data.multisigs });
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
    }
  }, [verifyIdentity, network]);

  // Switching network invalidates the session token, so reset back to the
  // idle (unauthenticated) state and let the admin re-load explicitly.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-runs on network change to reset state.
  useEffect(() => {
    setState({ kind: "idle" });
  }, [network]);

  if (!connected) {
    return (
      <Shell>
        <Alert>
          <AlertDescription>
            Connect your wallet to access the admin page.
          </AlertDescription>
        </Alert>
      </Shell>
    );
  }

  if (!isAdmin) {
    return (
      <Shell>
        <Alert variant="destructive">
          <AlertDescription>
            This wallet is not an admin. Access denied.
          </AlertDescription>
        </Alert>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          All multisigs on <span className="font-medium">{network}</span>
        </p>
        {state.kind === "loaded" && (
          <Button variant="outline" size="sm" onClick={load}>
            Refresh
          </Button>
        )}
      </div>

      {state.kind === "idle" && (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 pt-6">
            <p className="text-sm text-muted-foreground">
              Loading all multisigs requires signing a one-time verification
              message to prove admin access.
            </p>
            <Button onClick={load} className="w-full sm:w-auto">
              <ShieldCheck className="mr-1 h-4 w-4" />
              Authenticate &amp; load multisigs
            </Button>
          </CardContent>
        </Card>
      )}

      {state.kind === "loading" && (
        <p className="text-sm text-muted-foreground">Loading multisigs…</p>
      )}

      {state.kind === "error" && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0 break-words">{state.message}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={load}
              className="w-full shrink-0 sm:w-auto"
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {state.kind === "loaded" && (
        <LoadedList
          multisigs={state.multisigs}
          filter={filter}
          setFilter={setFilter}
        />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Admin</h1>
      {children}
    </div>
  );
}

function LoadedList({
  multisigs,
  filter,
  setFilter,
}: {
  multisigs: AdminMultisig[];
  filter: string;
  setFilter: (v: string) => void;
}) {
  if (multisigs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No multisigs registered on this network.
      </p>
    );
  }

  const q = filter.trim().toLowerCase();
  const visible = q
    ? multisigs.filter(
        (m) =>
          m.address.toLowerCase().includes(q) ||
          (m.label ?? "").toLowerCase().includes(q),
      )
    : multisigs;

  return (
    <div className="space-y-4">
      <Input
        placeholder="Filter by label or address…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      <p className="text-xs text-muted-foreground">
        {visible.length} of {multisigs.length} multisig
        {multisigs.length === 1 ? "" : "s"}
      </p>

      <div className="space-y-4">
        {visible.map((ms) => (
          <MultisigCard key={ms.id} ms={ms} />
        ))}
      </div>
    </div>
  );
}

function MultisigCard({ ms }: { ms: AdminMultisig }) {
  const { pending, ready, submitted } = ms.proposalCounts;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="min-w-0 flex-1 text-sm break-words">
            {ms.label ?? "Multisig"}
          </CardTitle>
          <div className="flex shrink-0 flex-wrap gap-1">
            <Badge variant="secondary">
              {ms.threshold}-of-{ms.signerCount}
            </Badge>
            <Badge variant="outline">{ms.network}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="break-all font-mono text-xs text-muted-foreground">
          {ms.address}
        </p>

        <div className="flex flex-wrap gap-2 text-xs">
          {pending > 0 && <Badge variant="default">{pending} pending</Badge>}
          {ready > 0 && (
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
              {ready} ready
            </Badge>
          )}
          {submitted > 0 && (
            <Badge variant="outline">{submitted} submitted</Badge>
          )}
          {pending === 0 && ready === 0 && submitted === 0 && (
            <span className="text-muted-foreground">No active proposals</span>
          )}
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>
            Balance:{" "}
            <span className="font-medium text-foreground">
              {ms.onChain === "ok" && ms.balanceApt !== null
                ? `${ms.balanceApt.toLocaleString(undefined, {
                    maximumFractionDigits: 4,
                  })} APT`
                : "—"}
            </span>
          </span>
          <span>
            Sequence:{" "}
            <span className="font-medium text-foreground">
              {ms.onChain === "ok" && ms.sequenceNumber !== null
                ? ms.sequenceNumber
                : "—"}
            </span>
          </span>
        </div>

        <Link
          href={`/multisig/${ms.address}?network=${ms.network}`}
          className={cn(buttonVariants({ size: "sm" }), "w-full sm:w-auto")}
        >
          Open Dashboard
        </Link>
      </CardContent>
    </Card>
  );
}
