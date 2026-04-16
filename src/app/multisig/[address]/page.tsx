"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { ProposalList } from "@/components/proposal-list";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWallet } from "@/components/wallet-provider";
import type { AptosNetwork } from "@/lib/aptos/client";
import { cn } from "@/lib/utils";

interface MultisigData {
  id: string;
  address: string;
  publicKeys: string[];
  threshold: number;
  network: string;
  label: string | null;
}

interface Props {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ network?: string }>;
}

function truncateKey(key: string): string {
  if (key.length <= 18) return key;
  return `${key.slice(0, 10)}...${key.slice(-8)}`;
}

export default function MultisigDashboardPage({
  params,
  searchParams,
}: Props) {
  const { address } = use(params);
  const { network: networkParam } = use(searchParams);
  const network = (networkParam ?? "mainnet") as AptosNetwork;

  const { connected, verifyIdentity } = useWallet();
  const [multisig, setMultisig] = useState<MultisigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMultisig = useCallback(async () => {
    try {
      const token = await verifyIdentity();
      const res = await fetch(
        `/api/multisig/${address}?network=${network}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error ?? "Failed to load multisig");
        return;
      }
      setMultisig(await res.json());
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load multisig",
      );
    } finally {
      setLoading(false);
    }
  }, [address, network, verifyIdentity]);

  useEffect(() => {
    if (connected) fetchMultisig();
  }, [connected, fetchMultisig]);

  if (!connected) {
    return (
      <div className="max-w-md mx-auto py-16 text-center space-y-4">
        <h2 className="text-2xl font-bold">Connect Wallet</h2>
        <p className="text-muted-foreground">
          Connect your wallet to view this multisig. Only signers can access
          multisig details.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-muted-foreground">Loading multisig...</p>
      </div>
    );
  }

  if (error || !multisig) {
    return (
      <div className="max-w-md mx-auto py-16 text-center space-y-4">
        <h2 className="text-2xl font-bold">Access Denied</h2>
        <p className="text-muted-foreground">
          {error ?? "Multisig not found"}
        </p>
        <a
          href="/"
          className="text-sm underline text-muted-foreground hover:text-foreground"
        >
          Back to home
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto w-full space-y-6 px-4 py-8">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">
            {multisig.label ?? "Multisig"}
          </h1>
          <Badge variant="outline">{network}</Badge>
        </div>
        <p className="text-sm text-muted-foreground font-mono break-all">
          {multisig.address}
        </p>
        <p className="text-sm text-muted-foreground">
          Threshold: {multisig.threshold}-of-{multisig.publicKeys.length}
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <Link
          href={`/multisig/${address}/propose?network=${network}`}
          className={cn(buttonVariants({ variant: "default" }))}
        >
          New Proposal
        </Link>
        <Link
          href={`/multisig/${address}/dapp?network=${network}`}
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Open dApp
        </Link>
      </div>

      {/* Signer list */}
      <Card>
        <CardHeader>
          <CardTitle>Signers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {multisig.publicKeys.map((key, index) => (
              <div key={key} className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground w-6 text-right">
                  {index}
                </span>
                <code className="text-xs">{truncateKey(key)}</code>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Proposals */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Proposals</h2>
        <ProposalList
          address={address}
          network={network}
          threshold={multisig.threshold}
          publicKeys={multisig.publicKeys}
        />
      </div>
    </div>
  );
}
