"use client";

import { useWallet as useAdapterWallet } from "@aptos-labs/wallet-adapter-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineSigningPanel } from "@/components/offline-signing-panel";
import { ProposalStatusBadge } from "@/components/proposal-status-badge";
import { SignerStatusGrid } from "@/components/signer-status-grid";
import {
  SimulationResult,
  type SimulationResultData,
  SimulationStatusBadge,
} from "@/components/simulation-result";
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
import { useWallet } from "@/components/wallet-provider";
import {
  extractEd25519SignatureHex,
  findSignerIndex,
} from "@/lib/aptos/signing";

interface ProposalPayload {
  module: string;
  function: string;
  typeArgs: string[];
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
  creatorPublicKey: string | null;
  creatorSignature: string | null;
  creatorFullMessage: string | null;
  creatorAddress: string | null;
  creatorRole: "signer" | "admin" | "unverified";
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

function getSourceBadge(source: string) {
  return source === "dapp" ? (
    <Badge variant="outline">dApp</Badge>
  ) : (
    <Badge variant="outline">Manual</Badge>
  );
}

function getCreatorRoleBadge(role: ProposalData["creatorRole"]) {
  switch (role) {
    case "signer":
      return <Badge variant="outline">Signer</Badge>;
    case "admin":
      return (
        <Badge className="bg-amber-500 text-white hover:bg-amber-500">
          Admin
        </Badge>
      );
    default:
      return <Badge variant="secondary">Unverified</Badge>;
  }
}

function shortHex(a: string) {
  const clean = a.replace(/^0x/, "");
  if (clean.length <= 16) return `0x${clean}`;
  return `0x${clean.slice(0, 8)}…${clean.slice(-6)}`;
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
    isAdmin,
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
  const [cancelling, setCancelling] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [simulation, setSimulation] = useState<SimulationResultData | null>(
    null,
  );
  const [simError, setSimError] = useState<string | null>(null);
  const [proofVerification, setProofVerification] = useState<
    "idle" | "valid" | "invalid"
  >("idle");
  const [verifyingProof, setVerifyingProof] = useState(false);

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
    fetchProposal().catch(console.error);
  }, [fetchProposal]);

  // Auto-run a simulation as soon as we have the proposal so users see the
  // expected balance changes without having to click "Simulate". Skipped for
  // already-submitted proposals (the chain has the real outcome by then) and
  // when a previous run is in flight.
  // biome-ignore lint/correctness/useExhaustiveDependencies: simulating/simulation are status flags, not effect inputs
  useEffect(() => {
    if (!proposal) return;
    if (proposal.status === "submitted") return;
    if (simulation || simulating) return;
    autoSimulate();
  }, [proposal?.id, proposal?.status]);

  // Poll on-chain status after submission at 5s, 10s, 60s
  const pollTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Only `proposal?.status` gates the effect; depending on `proposal` too
  // would restart polling on every unrelated refetch (new object identity
  // on each fetch).
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally narrow on `proposal?.status`; depending on `proposal` would restart polling on every unrelated refetch.
  useEffect(() => {
    pollTimers.current.forEach(clearTimeout);
    pollTimers.current = [];

    if (!proposal || proposal.status !== "submitted") return;

    const checkStatus = async () => {
      try {
        const res = await fetch(`/api/proposal/${proposalId}/check-status`, {
          method: "POST",
        });
        if (res.ok) {
          const data = await res.json();
          if (data.status !== "submitted") {
            await fetchProposal();
          }
        }
      } catch {
        // Ignore polling errors
      }
    };

    const delays = [5000, 10000, 60000];
    delays.forEach((delay) => {
      pollTimers.current.push(setTimeout(checkStatus, delay));
    });

    return () => {
      pollTimers.current.forEach(clearTimeout);
      pollTimers.current = [];
    };
  }, [proposal?.status, proposalId, fetchProposal]);

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
        <a
          href="/"
          className="text-sm underline text-muted-foreground hover:text-foreground"
        >
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
    findSignerIndex(proposal.multisig.publicKeys, publicKey) >= 0;
  const hasResponded =
    publicKey !== null &&
    proposal.responses.some(
      (r) =>
        r.publicKey.toLowerCase().replace(/^0x/, "") ===
        publicKey.toLowerCase().replace(/^0x/, ""),
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

      // Deserialize the stored transaction bytes back into a SimpleTransaction
      const { SimpleTransaction, Deserializer } = await import(
        "@aptos-labs/ts-sdk"
      );

      // Convert hex string to Uint8Array (browser-safe, no Buffer)
      const hex = proposal.rawTransactionBytes.replace(/^0x/, "");
      const txBytes = new Uint8Array(
        hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
      );
      const deserializer = new Deserializer(txBytes);
      const transaction = SimpleTransaction.deserialize(deserializer);

      // signTransaction returns an AccountAuthenticator with the Ed25519 signature.
      // The type cast is needed because the SDK's SimpleTransaction and the
      // adapter's AnyRawTransaction are structurally identical but from
      // potentially different package versions.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { authenticator } = await adapter.signTransaction({
        transactionOrPayload: transaction as any,
      });

      // Extract the raw Ed25519 signature from the authenticator. The helper
      // duck-types on the authenticator's variant (Ed25519 vs SingleKey) and
      // rejects any other wallet type (multi-key, secp256k1, etc).
      const sigHex = extractEd25519SignatureHex(authenticator);

      const res = await fetch(`/api/proposal/${proposalId}/sign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ signature: sigHex }),
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
      const token = await verifyIdentity();
      const res = await fetch(`/api/proposal/${proposalId}/submit`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to submit transaction");
      }

      await fetchProposal();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function runSimulation(): Promise<{
    ok: boolean;
    data?: SimulationResultData;
    error?: string;
  }> {
    if (!proposal) return { ok: false, error: "No proposal" };
    const res = await fetch("/api/multisig/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        multisigAddress: proposal.multisig.address,
        network: proposal.multisig.network,
        payload: {
          module: proposal.payload.module,
          function: proposal.payload.function,
          typeArgs: proposal.payload.typeArgs,
          args: proposal.payload.args,
        },
        maxGasAmount: proposal.maxGasAmount,
        gasUnitPrice: proposal.gasUnitPrice,
      }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error ?? "Simulation failed" };
    return { ok: true, data };
  }

  async function autoSimulate() {
    setSimulating(true);
    try {
      const result = await runSimulation();
      if (result.ok && result.data) setSimulation(result.data);
      // Don't surface errors from the auto-run: the user can still click
      // "Simulate" to see a real error message.
    } catch {
      /* swallow */
    } finally {
      setSimulating(false);
    }
  }

  async function handleSimulate() {
    if (!proposal) return;
    setSimulating(true);
    setSimError(null);
    setSimulation(null);
    try {
      const result = await runSimulation();
      if (!result.ok) {
        setSimError(result.error ?? "Simulation failed");
      } else if (result.data) {
        setSimulation(result.data);
      }
    } catch (err) {
      setSimError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setSimulating(false);
    }
  }

  async function handleCancel() {
    if (!proposal) return;
    setCancelling(true);
    setActionError(null);
    try {
      const token = await verifyIdentity();
      const res = await fetch(`/api/proposal/${proposalId}/cancel`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to cancel");
      }
      await fetchProposal();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setCancelling(false);
    }
  }

  async function handleVerifyProof() {
    if (
      !proposal?.creatorPublicKey ||
      !proposal.creatorSignature ||
      !proposal.creatorFullMessage
    ) {
      return;
    }
    setVerifyingProof(true);
    try {
      const { Ed25519PublicKey, Ed25519Signature } = await import(
        "@aptos-labs/ts-sdk"
      );
      const { buildProposalProofCanonicalString } = await import(
        "@/lib/auth/proposal-proof"
      );
      const hex = proposal.rawTransactionBytes.replace(/^0x/, "");
      const rawTxBytes = Uint8Array.from(
        (hex.match(/.{1,2}/g) ?? []).map((b: string) => parseInt(b, 16)),
      );
      const canonical = await buildProposalProofCanonicalString(rawTxBytes);
      const pubKey = new Ed25519PublicKey(proposal.creatorPublicKey);
      const sig = new Ed25519Signature(proposal.creatorSignature);
      const messageBytes = new TextEncoder().encode(
        proposal.creatorFullMessage,
      );
      const sigOk = pubKey.verifySignature({
        message: messageBytes,
        signature: sig,
      });
      const embedded = proposal.creatorFullMessage.includes(canonical);
      setProofVerification(sigOk && embedded ? "valid" : "invalid");
    } catch {
      setProofVerification("invalid");
    } finally {
      setVerifyingProof(false);
    }
  }

  const signedCount = proposal.responses.filter(
    (r) => r.response === "signed",
  ).length;

  const payload = proposal.payload;
  const expirationDate = new Date(
    proposal.expirationTimestampSecs * 1000,
  ).toLocaleString();

  return (
    <div className="w-full space-y-6 p-4">
      {/* Header card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Proposal</CardTitle>
            <div className="flex gap-2">
              {getSourceBadge(proposal.source)}
              <ProposalStatusBadge
                status={proposal.status}
                expirationTimestampSecs={proposal.expirationTimestampSecs}
              />
            </div>
          </div>
          <CardDescription>{proposal.description}</CardDescription>
        </CardHeader>
      </Card>

      {/* Proposed by */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Proposed By</CardTitle>
            {getCreatorRoleBadge(proposal.creatorRole)}
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {proposal.creatorAddress ? (
            <div>
              <a
                href={`https://explorer.aptoslabs.com/account/${proposal.creatorAddress}?network=${proposal.multisig.network}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-blue-600 hover:underline break-all"
                title={
                  proposal.creatorPublicKey
                    ? `Public key: ${proposal.creatorPublicKey}`
                    : undefined
                }
              >
                {proposal.creatorAddress}
              </a>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Legacy proposal — no creator proof on record.
            </p>
          )}

          {proposal.creatorPublicKey && proposal.creatorSignature && (
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleVerifyProof}
                disabled={verifyingProof}
              >
                {verifyingProof ? "Verifying..." : "Verify proof"}
              </Button>
              {proofVerification === "valid" && (
                <span className="text-green-600 text-xs">✓ Proof is valid</span>
              )}
              {proofVerification === "invalid" && (
                <span className="text-red-600 text-xs">
                  ✗ Proof did not verify
                </span>
              )}
              {proposal.creatorPublicKey && (
                <code
                  className="text-[10px] text-muted-foreground"
                  title={proposal.creatorPublicKey}
                >
                  pk {shortHex(proposal.creatorPublicKey)}
                </code>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transaction details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transaction Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <span className="font-medium">Multisig: </span>
            <a
              href={`https://explorer.aptoslabs.com/account/${proposal.multisig.address}?network=${proposal.multisig.network}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-blue-600 hover:underline break-all"
            >
              {proposal.multisig.address}
            </a>
          </div>
          <div>
            <span className="font-medium">Function: </span>
            <code className="text-xs">
              {payload.module}::{payload.function}
            </code>
          </div>
          {payload.typeArgs.length > 0 && (
            <div>
              <span className="font-medium">Type Arguments: </span>
              <code className="text-xs">{payload.typeArgs.join(", ")}</code>
            </div>
          )}
          {payload.args.length > 0 && (
            <div>
              <span className="font-medium">Arguments: </span>
              <code className="text-xs">{payload.args.join(", ")}</code>
            </div>
          )}
          <div>
            <span className="font-medium">Sequence Number: </span>
            <code className="text-xs">{proposal.sequenceNumber}</code>
          </div>
          <div>
            <span className="font-medium">Max Gas: </span>
            {proposal.maxGasAmount.toLocaleString()}
          </div>
          <div>
            <span className="font-medium">Gas Unit Price: </span>
            {proposal.gasUnitPrice.toLocaleString()}
          </div>
          <div>
            <span className="font-medium">Max Fee: </span>
            {(proposal.maxGasAmount * proposal.gasUnitPrice).toLocaleString()}{" "}
            <span className="text-xs text-muted-foreground">
              octas (≈{" "}
              {((proposal.maxGasAmount * proposal.gasUnitPrice) / 1e8).toFixed(
                8,
              )}{" "}
              APT)
            </span>
          </div>
          <div>
            <span className="font-medium">Expiration: </span>
            {expirationDate}
          </div>
          <div>
            <span className="font-medium">Created: </span>
            {new Date(proposal.createdAt).toLocaleString()}
          </div>
          {proposal.updatedAt !== proposal.createdAt && (
            <div>
              <span className="font-medium">Last Updated: </span>
              {new Date(proposal.updatedAt).toLocaleString()}
            </div>
          )}
          <div>
            <span className="font-medium">Source: </span>
            <code className="text-xs">{proposal.source}</code>
            {proposal.sourceDappUrl && (
              <span className="text-xs text-muted-foreground">
                {" "}
                ({proposal.sourceDappUrl})
              </span>
            )}
          </div>
          {proposal.feePayerAddress && (
            <div>
              <span className="font-medium">Fee Payer: </span>
              <a
                href={`https://explorer.aptoslabs.com/account/${proposal.feePayerAddress}?network=${proposal.multisig.network}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-blue-600 hover:underline break-all"
              >
                {proposal.feePayerAddress}
              </a>
              {proposal.feePayerSignature ? (
                <span className="ml-2 text-xs text-green-600">✓ signed</span>
              ) : (
                <span className="ml-2 text-xs text-muted-foreground">
                  awaiting signature
                </span>
              )}
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
              <span className="font-medium text-destructive">
                Failure Reason:{" "}
              </span>
              <span className="text-xs text-destructive">
                {proposal.failureReason}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Simulation */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Simulation</CardTitle>
            <div className="flex items-center gap-2">
              {simulation && <SimulationStatusBadge simulation={simulation} />}
              <Button
                variant="outline"
                size="sm"
                onClick={handleSimulate}
                disabled={simulating}
              >
                {simulating ? "Simulating..." : "Simulate"}
              </Button>
            </div>
          </div>
          <CardDescription>
            Preview what this transaction would do, without actually submitting
            it on-chain.
          </CardDescription>
        </CardHeader>
        {(simulation || simError) && (
          <CardContent className="space-y-3 text-sm">
            {simError && <p className="text-destructive text-xs">{simError}</p>}
            {simulation && (
              <SimulationResult
                simulation={simulation}
                textSize="text-sm"
                multisigAddress={proposal.multisig.address}
              />
            )}
          </CardContent>
        )}
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

      {/* Offline signing / signature verification */}
      <OfflineSigningPanel
        rawTransactionBytes={proposal.rawTransactionBytes}
        publicKeys={proposal.multisig.publicKeys}
        responses={proposal.responses}
      />

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

      {/* Cancel button — any signer or admin can cancel a pending/ready proposal */}
      {connected &&
        (isSigner || isAdmin) &&
        (proposal.status === "pending" || proposal.status === "ready") && (
          <Card>
            <CardContent className="pt-6 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {isSigner
                  ? "Any signer can cancel this proposal."
                  : "Admins can cancel any proposal."}
              </p>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleCancel}
                disabled={cancelling}
              >
                {cancelling ? "Cancelling..." : "Cancel Proposal"}
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
          onClick={() =>
            (window.location.href = `/multisig/${proposal.multisig.address}?network=${proposal.multisig.network}`)
          }
        >
          Back to Dashboard
        </Button>
        <Button
          onClick={() =>
            (window.location.href = `/multisig/${proposal.multisig.address}/propose?network=${proposal.multisig.network}`)
          }
        >
          New Proposal
        </Button>
      </div>
    </div>
  );
}
