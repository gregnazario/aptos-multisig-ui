"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  effectiveProposalStatus,
  ProposalStatusBadge,
} from "@/components/proposal-status-badge";
import { SignerStatusGrid } from "@/components/signer-status-grid";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AptosNetwork } from "@/lib/aptos/client";

interface SignerResponse {
  id: string;
  proposalId: string;
  signerIndex: number;
  publicKey: string;
  response: string;
  signature: string | null;
  declineReason: string | null;
  createdAt: string;
}

interface Proposal {
  id: string;
  multisigId: string;
  description: string;
  source: string;
  sourceDappUrl: string | null;
  payload: {
    module: string;
    function: string;
    typeArgs: string[];
    args: unknown[];
  };
  rawTransactionBytes: string;
  sequenceNumber: number;
  maxGasAmount: number;
  gasUnitPrice: number;
  expirationTimestampSecs: number;
  feePayerAddress: string | null;
  feePayerSignature: string | null;
  status: string;
  txHash: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  responses: SignerResponse[];
  signedCount: number;
  declinedCount: number;
}

interface ProposalListProps {
  address: string;
  network: AptosNetwork;
  threshold: number;
  publicKeys: string[];
}

function getEffectiveStatus(proposal: Proposal): string {
  return effectiveProposalStatus(
    proposal.status,
    proposal.expirationTimestampSecs,
  );
}

export function ProposalList({
  address,
  network,
  threshold,
  publicKeys,
}: ProposalListProps) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProposals() {
      try {
        const res = await fetch(
          `/api/multisig/${address}/proposals?network=${network}`,
        );
        if (!res.ok) {
          throw new Error("Failed to fetch proposals");
        }
        const data = await res.json();
        setProposals(data);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    fetchProposals().catch(console.error);
  }, [address, network]);

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">Loading proposals...</p>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">Error: {error}</p>;
  }

  if (proposals.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No proposals yet. Create the first one!
      </p>
    );
  }

  // Split into active (still actionable) and inactive (terminal states).
  // Active: pending + ready, sorted by sequence number ascending so the
  // next-to-land sits at the top — important when queuing multiple txs.
  // Inactive: submitted/cancelled/expired/failed, sorted by updatedAt desc
  // so the most recent terminal events show first.
  const active: Proposal[] = [];
  const inactive: Proposal[] = [];
  for (const p of proposals) {
    const status = getEffectiveStatus(p);
    if (status === "pending" || status === "ready") active.push(p);
    else inactive.push(p);
  }
  active.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  inactive.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  function renderProposal(proposal: Proposal) {
    const entryFunction = `${proposal.payload.module}::${proposal.payload.function}`;
    return (
      <Link key={proposal.id} href={`/tx/${proposal.id}`} className="block">
        <Card className="hover:border-primary/50 transition-colors">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">
                {proposal.description}
              </CardTitle>
              <div className="flex items-center gap-2 shrink-0">
                <ProposalStatusBadge
                  status={proposal.status}
                  expirationTimestampSecs={proposal.expirationTimestampSecs}
                />
                <Badge
                  variant="outline"
                  title={`Sequence number ${proposal.sequenceNumber}`}
                >
                  seq #{proposal.sequenceNumber}
                </Badge>
                {proposal.source === "dapp" && (
                  <Badge variant="secondary">dApp</Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <code className="text-xs text-muted-foreground">
              {entryFunction}
            </code>
            <SignerStatusGrid
              publicKeys={publicKeys}
              responses={proposal.responses}
              threshold={threshold}
            />
          </CardContent>
        </Card>
      </Link>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">
            Active{" "}
            <span className="text-muted-foreground font-normal">
              ({active.length})
            </span>
          </h3>
          {active.length > 0 && (
            <p className="text-xs text-muted-foreground">
              ordered by sequence number
            </p>
          )}
        </div>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active proposals. Create a new one to get started.
          </p>
        ) : (
          <div className="space-y-4">{active.map(renderProposal)}</div>
        )}
      </section>

      {inactive.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-muted-foreground">
              History <span className="font-normal">({inactive.length})</span>
            </h3>
            <p className="text-xs text-muted-foreground">
              submitted, cancelled, expired, failed
            </p>
          </div>
          <div className="space-y-4 opacity-90">
            {inactive.map(renderProposal)}
          </div>
        </section>
      )}
    </div>
  );
}
