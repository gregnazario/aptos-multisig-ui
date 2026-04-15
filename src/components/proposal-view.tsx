"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet as useAdapterWallet } from "@aptos-labs/wallet-adapter-react";
import { useWallet } from "@/components/wallet-provider";
import { SignerStatusGrid } from "@/components/signer-status-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

interface ProposalPayload {
  module: string;
  function: string;
  typeArgs?: string[];
  type_args?: string[];
  args: string[];
}

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

interface ProposalData {
  id: string;
  multisigId: string;
  description: string;
  source: string;
  sourceDappUrl: string | null;
  payload: ProposalPayload;
  rawTransactionBytes: string;
  sequenceNumber: number;
  maxGasAmount: number;
  gasUnitPrice: number;
  expirationTimestampSecs: number;
  feePayerAddress: string | null;
  feePayerSignature: string | null;
  status: string;
  txHash: string | null;
  failureReason: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  multisig: {
    id: string;
    address: string;
    publicKeys: string[];
    threshold: number;
    network: string;
    label: string | null;
  };
  responses: SignerResponse[];
}

/** Client-safe signer index lookup (no SDK import) */
function findSignerIndexClient(
  publicKeyHexes: string[],
  signerPublicKeyHex: string
): number {
  const normalized = signerPublicKeyHex.toLowerCase().replace(/^0x/, "");
  return publicKeyHexes.findIndex(
    (pk) => pk.toLowerCase().replace(/^0x/, "") === normalized
  );
}

function getStatusBadge(status: string, expirationSecs: number) {
  const now = Math.floor(Date.now() / 1000);
  if (status === "pending" && expirationSecs < now) {
    return <Badge variant="destructive">Expired</Badge>;
  }
  switch (status) {
    case "pending":
      return <Badge variant="secondary">Pending</Badge>;
    case "ready":
      return <Badge className="bg-green-600 text-white">Ready</Badge>;
    case "submitted":
      return <Badge className="bg-blue-600 text-white">Submitted</Badge>;
    case "expired":
      return <Badge variant="destructive">Expired</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function getSourceBadge(source: string) {
  return source === "dapp" ? (
    <Badge variant="outline">dApp</Badge>
  ) : (
    <Badge variant="outline">Manual</Badge>
  );
}

interface ProposalViewProps {
  proposalId: string;
}

export function ProposalView({ proposalId }: ProposalViewProps) {
  const adapter = useAdapterWallet();
  const {
    connected,
    publicKey,
    network: walletNetwork,
    verifyIdentity,
  } = useWallet();

  const [proposal, setProposal] = useState<ProposalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fetchProposal = useCallback(async () => {
    try {
      const res = await fetch(`/api/proposal/${proposalId}`);
      if (!res.ok) {
        const err = await res.json();
        setError(err.error ?? "Failed to load proposal");
        return;
      }
      const data = await res.json();
      setProposal(data);
      setError(null);
    } catch {
      setError("Failed to load proposal");
    } finally {
      setLoading(false);
    }
  }, [proposalId]);

  useEffect(() => {
    fetchProposal();
  }, [fetchProposal]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-muted-foreground">Loading proposal...</p>
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div className="mx-auto max-w-md py-16 text-center space-y-4">
        <h2 className="text-2xl font-bold">Proposal Not Found</h2>
        <p className="text-muted-foreground">
          This proposal doesn&apos;t exist or may have been removed. Check that
          the link is correct.
        </p>
        <a href="/" className="text-sm underline text-muted-foreground hover:text-foreground">
          Back to home
        </a>
      </div>
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const isExpired =
    proposal.status === "expired" || proposal.expirationTimestampSecs < now;
  const isSigner =
    publicKey !== null &&
    findSignerIndexClient(proposal.multisig.publicKeys, publicKey) >= 0;
  const hasResponded =
    publicKey !== null &&
    proposal.responses.some(
      (r) =>
        r.publicKey.toLowerCase().replace(/^0x/, "") ===
        publicKey.toLowerCase().replace(/^0x/, "")
    );
  const networkMatches =
    walletNetwork?.toLowerCase() === proposal.multisig.network.toLowerCase();
  const canAct =
    connected &&
    isSigner &&
    !hasResponded &&
    !isExpired &&
    networkMatches &&
    proposal.status === "pending";

  async function handleSign() {
    if (!proposal) return;
    setSigning(true);
    setActionError(null);
    try {
      const token = await verifyIdentity();

      const signResult = await adapter.signMessage({
        message: proposal.rawTransactionBytes,
        nonce: proposalId,
      });

      const res = await fetch(`/api/proposal/${proposalId}/sign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ signature: signResult.signature.toString() }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to sign");
      }

      await fetchProposal();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Signing failed");
    } finally {
      setSigning(false);
    }
  }

  async function handleDecline() {
    if (!proposal) return;
    setDeclining(true);
    setActionError(null);
    try {
      const token = await verifyIdentity();

      const res = await fetch(`/api/proposal/${proposalId}/decline`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reason: declineReason.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to decline");
      }

      setShowDeclineForm(false);
      setDeclineReason("");
      await fetchProposal();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Decline failed");
    } finally {
      setDeclining(false);
    }
  }

  async function handleSubmit() {
    if (!proposal) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/proposal/${proposalId}/submit`, {
        method: "POST",
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to submit transaction");
      }

      await fetchProposal();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Submission failed"
      );
    } finally {
      setSubmitting(false);
    }
  }

  const signedCount = proposal.responses.filter(
    (r) => r.response === "signed"
  ).length;

  const payload = proposal.payload;
  const expirationDate = new Date(
    proposal.expirationTimestampSecs * 1000
  ).toLocaleString();

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      {/* Header card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Proposal</CardTitle>
            <div className="flex gap-2">
              {getSourceBadge(proposal.source)}
              {getStatusBadge(
                proposal.status,
                proposal.expirationTimestampSecs
              )}
            </div>
          </div>
          <CardDescription>{proposal.description}</CardDescription>
        </CardHeader>
      </Card>

      {/* Transaction details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transaction Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <span className="font-medium">Function: </span>
            <code className="text-xs">
              {payload.module}::{payload.function}
            </code>
          </div>
          {(payload.typeArgs ?? payload.type_args ?? []).length > 0 && (
            <div>
              <span className="font-medium">Type Arguments: </span>
              <code className="text-xs">
                {(payload.typeArgs ?? payload.type_args ?? []).join(", ")}
              </code>
            </div>
          )}
          {payload.args.length > 0 && (
            <div>
              <span className="font-medium">Arguments: </span>
              <code className="text-xs">{payload.args.join(", ")}</code>
            </div>
          )}
          <div>
            <span className="font-medium">Max Gas: </span>
            {proposal.maxGasAmount}
          </div>
          <div>
            <span className="font-medium">Gas Unit Price: </span>
            {proposal.gasUnitPrice}
          </div>
          <div>
            <span className="font-medium">Expiration: </span>
            {expirationDate}
          </div>
          {proposal.feePayerAddress && (
            <div>
              <span className="font-medium">Fee Payer: </span>
              <code className="text-xs">{proposal.feePayerAddress}</code>
            </div>
          )}
          {proposal.txHash && (
            <div>
              <span className="font-medium">Tx Hash: </span>
              <a
                href={`https://explorer.aptoslabs.com/txn/${proposal.txHash}?network=${proposal.multisig.network}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-blue-600 hover:underline break-all"
              >
                {proposal.txHash}
              </a>
            </div>
          )}
          {proposal.failureReason && (
            <div>
              <span className="font-medium text-destructive">Failure Reason: </span>
              <span className="text-xs text-destructive">{proposal.failureReason}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Signer status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Signers</CardTitle>
        </CardHeader>
        <CardContent>
          <SignerStatusGrid
            publicKeys={proposal.multisig.publicKeys}
            responses={proposal.responses}
            threshold={proposal.multisig.threshold}
          />
        </CardContent>
      </Card>

      {/* Network mismatch warning */}
      {connected && isSigner && !networkMatches && !isExpired && (
        <Card className="border-yellow-500">
          <CardContent className="pt-6">
            <p className="text-sm text-yellow-600">
              Network mismatch: your wallet is on{" "}
              <strong>{walletNetwork}</strong> but this proposal is on{" "}
              <strong>{proposal.multisig.network}</strong>. Please switch your
              wallet network to sign.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Action card */}
      {canAct && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {actionError && (
              <p className="text-sm text-destructive">{actionError}</p>
            )}

            <div className="flex gap-3">
              <Button onClick={handleSign} disabled={signing || declining}>
                {signing ? "Signing..." : "Sign Transaction"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowDeclineForm(!showDeclineForm)}
                disabled={signing || declining}
              >
                Decline
              </Button>
            </div>

            {showDeclineForm && (
              <div className="space-y-3">
                <Textarea
                  placeholder="Reason for declining (optional)"
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                />
                <Button
                  variant="destructive"
                  onClick={handleDecline}
                  disabled={declining}
                >
                  {declining ? "Declining..." : "Confirm Decline"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Submit card */}
      {proposal.status === "ready" && (
        <Card className="border-green-500">
          <CardHeader>
            <CardTitle className="text-base">Submit Transaction</CardTitle>
            <CardDescription>
              Threshold reached ({signedCount}/{proposal.multisig.threshold}).
              Ready to submit.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {submitError && (
              <p className="text-sm text-destructive">{submitError}</p>
            )}
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Submitting..." : "Submit Transaction"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Not connected message */}
      {!connected && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Connect your wallet to sign or decline this proposal.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex gap-3 pt-2">
        <Button
          variant="outline"
          onClick={() => window.location.href = `/multisig/${proposal.multisig.address}?network=${proposal.multisig.network}`}
        >
          Back to Dashboard
        </Button>
        <Button
          onClick={() => window.location.href = `/multisig/${proposal.multisig.address}/propose?network=${proposal.multisig.network}`}
        >
          New Proposal
        </Button>
      </div>
    </div>
  );
}
