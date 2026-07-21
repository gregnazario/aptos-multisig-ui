"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWallet } from "@/components/wallet-provider";

interface MultisigRecord {
  id: string;
  address: string;
  publicKeys: string[];
  threshold: number;
  network: string;
  label: string | null;
}

interface PendingSetup {
  id: string;
  addresses: string[];
  threshold: number;
  network: string;
  label: string | null;
  createdBy: string;
  verifiedCount: number;
  totalSigners: number;
}

interface Data {
  multisigs: MultisigRecord[];
  pendingSetups: PendingSetup[];
}

export function MyMultisigs() {
  const { connected, address, network } = useWallet();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!connected || !address) {
      setData(null);
      return;
    }

    setLoading(true);
    fetch(
      `/api/multisig/by-signer?address=${encodeURIComponent(address)}&network=${network}`,
    )
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [connected, address, network]);

  if (!connected) return null;

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">Loading your multisigs...</p>
    );
  }

  const hasMultisigs = data && data.multisigs.length > 0;
  const hasPending = data && data.pendingSetups.length > 0;

  if (!hasMultisigs && !hasPending) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Your Multisigs</h2>

      {data?.multisigs.map((ms) => (
        <Card key={ms.id}>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <CardTitle className="min-w-0 flex-1 text-sm break-words">
                {ms.label ?? "Multisig"}
              </CardTitle>
              <div className="flex shrink-0 flex-wrap gap-1">
                <Badge variant="secondary">
                  {ms.threshold}-of-{ms.publicKeys.length}
                </Badge>
                <Badge variant="outline">{ms.network}</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs font-mono text-muted-foreground mb-3 break-all">
              {ms.address}
            </p>
            <Button
              size="sm"
              className="w-full sm:w-auto"
              onClick={() =>
                (window.location.href = `/multisig/${ms.address}?network=${ms.network}`)
              }
            >
              Open Dashboard
            </Button>
          </CardContent>
        </Card>
      ))}

      {hasPending && (
        <>
          <h3 className="text-sm font-medium text-muted-foreground">
            Pending Setups
          </h3>
          {data?.pendingSetups.map((s) => (
            <Card key={s.id} className="border-dashed">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <CardTitle className="min-w-0 flex-1 text-sm break-words">
                    {s.label ?? "Pending Setup"}
                  </CardTitle>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    <Badge variant="secondary">
                      {s.threshold}-of-{s.totalSigners}
                    </Badge>
                    <Badge variant="outline">{s.network}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-3">
                  {s.verifiedCount} of {s.totalSigners} signers verified
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() =>
                    (window.location.href = `/multisig/setup/${s.id}`)
                  }
                >
                  Complete Setup
                </Button>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
