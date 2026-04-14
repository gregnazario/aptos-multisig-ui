"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SignerStatusGrid } from "@/components/signer-status-grid";
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
    type_args: string[];
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
  if (proposal.status === "pending") {
    const now = Math.floor(Date.now() / 1000);
    if (proposal.expirationTimestampSecs < now) {
      return "expired";
    }
  }
  return proposal.status;
}

function statusVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "ready":
      return "default";
    case "submitted":
      return "secondary";
    case "expired":
    case "failed":
      return "destructive";
    default:
      return "outline";
  }
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
          `/api/multisig/${address}/proposals?network=${network}`
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
    fetchProposals();
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

  return (
    <div className="space-y-4">
      {proposals.map((proposal) => {
        const effectiveStatus = getEffectiveStatus(proposal);
        const entryFunction = `${proposal.payload.module}::${proposal.payload.function}`;

        return (
          <Link
            key={proposal.id}
            href={`/tx/${proposal.id}`}
            className="block"
          >
            <Card className="hover:border-primary/50 transition-colors">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">
                    {proposal.description}
                  </CardTitle>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={statusVariant(effectiveStatus)}>
                      {effectiveStatus}
                    </Badge>
                    <Badge variant="outline">
                      #{proposal.sequenceNumber}
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
      })}
    </div>
  );
}
