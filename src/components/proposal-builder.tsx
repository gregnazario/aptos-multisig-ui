"use client";

import { useWallet as useAdapterWallet } from "@aptos-labs/wallet-adapter-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { AbiFunctionForm } from "@/components/abi-function-form";
import {
  SimulationResult,
  type SimulationResultData,
  SimulationStatusBadge,
} from "@/components/simulation-result";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useWallet } from "@/components/wallet-provider";
import type { AptosNetwork } from "@/lib/aptos/client";
import { buildProposalProofCanonicalString } from "@/lib/auth/proposal-proof";
import { encodeProposalUrl, type UrlProposalData } from "@/lib/url-state";

type StorageMode = "url" | "server";

interface ProposalBuilderProps {
  multisigAddress: string;
  network: AptosNetwork;
  threshold: number;
  publicKeys: string[];
  /** Optional prefills (e.g. from balance Transfer links). */
  initialModuleAddress?: string;
  initialModuleName?: string;
  initialFunctionName?: string;
  initialTypeArgs?: string[];
  initialArgs?: string[];
  initialDescription?: string;
}

export function ProposalBuilder({
  multisigAddress,
  network,
  threshold,
  publicKeys,
  initialModuleAddress,
  initialModuleName,
  initialFunctionName,
  initialTypeArgs,
  initialArgs,
  initialDescription,
}: ProposalBuilderProps) {
  const { connected } = useWallet();
  const adapter = useAdapterWallet();

  const [mode, setMode] = useState<StorageMode>("server");
  const [description, setDescription] = useState(initialDescription ?? "");
  const [moduleAddress, setModuleAddress] = useState(
    initialModuleAddress ?? "0x1",
  );
  const [moduleName, setModuleName] = useState(
    initialModuleName ?? "aptos_account",
  );
  const [functionName, setFunctionName] = useState(
    initialFunctionName ?? "transfer",
  );
  const [maxGas, setMaxGas] = useState(100000);
  const [gasPrice, setGasPrice] = useState(100);
  const [expirationHours, setExpirationHours] = useState(24);
  const [feePayerAddress, setFeePayerAddress] = useState("");
  // Optional manual override for the sequence number. Leave empty to let the
  // SDK auto-fetch the multisig's current on-chain sequence number. Set
  // explicitly when queueing multiple proposals — each one needs a distinct
  // sequence number (typically `currentOnChain + 0`, `+ 1`, `+ 2`, ...).
  const [sequenceOverride, setSequenceOverride] = useState("");
  const [onChainSeq, setOnChainSeq] = useState<number | null>(null);

  // ABI-driven form state
  const [abiTypeArgs, setAbiTypeArgs] = useState<string[]>(
    initialTypeArgs ?? [],
  );
  const [abiArgs, setAbiArgs] = useState<string[]>(initialArgs ?? []);

  // Simulation
  const [simulating, setSimulating] = useState(false);
  const [simulation, setSimulation] = useState<SimulationResultData | null>(
    null,
  );
  const [simError, setSimError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successUrl, setSuccessUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Fetch the multisig's current on-chain sequence number once so we can
  // show the user what "auto" would resolve to and what the next free slot
  // is when queueing.
  useEffect(() => {
    let cancelled = false;
    fetch(
      `/api/multisig/${encodeURIComponent(multisigAddress)}/sequence-number?network=${network}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { sequenceNumber?: number } | null) => {
        if (!cancelled && data && typeof data.sequenceNumber === "number") {
          setOnChainSeq(data.sequenceNumber);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [multisigAddress, network]);

  const handleAbiChange = useCallback(
    (values: {
      typeArgs: string[];
      args: string[];
      abi: { isEntry: boolean; params: string[] } | null;
    }) => {
      setAbiTypeArgs(values.typeArgs);
      setAbiArgs(values.args);
      // Clear previous simulation when inputs change
      setSimulation(null);
      setSimError(null);
    },
    [],
  );

  function buildPayload() {
    return {
      module: `${moduleAddress.trim()}::${moduleName.trim()}`,
      function: functionName.trim(),
      typeArgs: abiTypeArgs.filter(Boolean),
      args: abiArgs.filter((a) => a !== ""),
    };
  }

  async function handleSimulate() {
    setSimulating(true);
    setSimulation(null);
    setSimError(null);

    try {
      const payload = buildPayload();
      const res = await fetch("/api/multisig/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          multisigAddress,
          network,
          payload,
          maxGasAmount: maxGas,
          gasUnitPrice: gasPrice,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setSimError(data.error ?? "Simulation failed");
      } else {
        setSimulation(data);
      }
    } catch (err) {
      setSimError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setSimulating(false);
    }
  }

  async function handleSubmit(e: React.SubmitEvent) {
    e.preventDefault();
    setError(null);
    setSuccessUrl(null);
    setLoading(true);

    try {
      if (!description.trim()) {
        throw new Error("Description is required.");
      }
      if (!moduleAddress.trim() || !moduleName.trim() || !functionName.trim()) {
        throw new Error(
          "Module address, module name, and function name are required.",
        );
      }

      const payload = buildPayload();

      const seqOverrideTrimmed = sequenceOverride.trim();
      let parsedSeq: number | undefined;
      if (seqOverrideTrimmed.length > 0) {
        const n = Number(seqOverrideTrimmed);
        if (!Number.isInteger(n) || n < 0) {
          throw new Error(
            "Sequence number must be a non-negative integer (or leave it blank).",
          );
        }
        parsedSeq = n;
      }

      const buildRes = await fetch("/api/multisig/build-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          multisigAddress,
          network,
          payload,
          maxGasAmount: maxGas,
          gasUnitPrice: gasPrice,
          expirationSeconds: expirationHours * 3600,
          feePayerAddress: feePayerAddress.trim() || undefined,
          sequenceNumber: parsedSeq,
        }),
      });

      if (!buildRes.ok) {
        const errData = await buildRes.json();
        throw new Error(errData.error ?? "Failed to build transaction");
      }

      const built = await buildRes.json();

      if (mode === "url") {
        const urlData: UrlProposalData = {
          pks: publicKeys,
          th: threshold,
          net: network,
          tx: built.rawTransactionBytes,
          desc: description.trim(),
          fn: `${moduleAddress.trim()}::${moduleName.trim()}::${functionName.trim()}`,
          args: payload.args.length > 0 ? payload.args : undefined,
          seq: built.sequenceNumber,
          exp: built.expirationTimestampSecs,
          gas: built.maxGasAmount,
          gasPrice: built.gasUnitPrice,
          sigs: [],
        };

        const urlPath = encodeProposalUrl(urlData);
        setSuccessUrl(`${window.location.origin}${urlPath}`);
      } else {
        // Build the canonical proof string from the just-built raw tx bytes
        // and ask the wallet to sign it. The wallet wraps our message in its
        // own envelope; we send both the signature and the full wrapped
        // message so the server can verify and confirm authorship.
        const hex = built.rawTransactionBytes.replace(/^0x/, "");
        const rawTxBytes = Uint8Array.from(
          (hex.match(/.{1,2}/g) ?? []).map((b: string) => parseInt(b, 16)),
        );
        const canonical = await buildProposalProofCanonicalString(rawTxBytes);
        const nonce = crypto.randomUUID();
        const signResult = await adapter.signMessage({
          message: canonical,
          nonce,
        });
        const creatorPublicKey = adapter.account?.publicKey?.toString();
        if (!creatorPublicKey) {
          throw new Error("Connected wallet has no public key.");
        }
        const creatorSignature = signResult.signature.toString();
        const creatorFullMessage = signResult.fullMessage;

        const res = await fetch(
          `/api/multisig/${encodeURIComponent(multisigAddress)}/proposals`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              network,
              description: description.trim(),
              payload,
              maxGasAmount: maxGas,
              gasUnitPrice: gasPrice,
              expirationSeconds: expirationHours * 3600,
              feePayerAddress: feePayerAddress.trim() || undefined,
              source: "manual",
              sequenceNumber: built.sequenceNumber,
              expirationTimestampSecs: built.expirationTimestampSecs,
              creatorPublicKey,
              creatorSignature,
              creatorFullMessage,
            }),
          },
        );

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error ?? "Failed to create proposal");
        }

        const data = await res.json();
        setSuccessUrl(`${window.location.origin}${data.url}`);
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function copyToClipboard() {
    if (!successUrl) return;
    try {
      await navigator.clipboard.writeText(successUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  // Success state
  if (successUrl) {
    const txPath = successUrl.replace(window.location.origin, "");
    return (
      <Card>
        <CardHeader>
          <CardTitle>Proposal Created</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertDescription>
              Share this link with signers.{" "}
              {mode === "url"
                ? "All data is encoded in the URL — no server needed."
                : "Proposal stored on server."}
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label>Shareable Link</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={successUrl}
                readOnly
                className="min-w-0 flex-1 font-mono text-xs"
              />
              <Button
                variant="outline"
                onClick={copyToClipboard}
                className="w-full shrink-0 sm:w-auto"
              >
                {copied ? "Copied!" : "Copy"}
              </Button>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            {threshold}-of-{publicKeys.length} signatures required.
          </p>

          <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
            <Button
              className="w-full sm:w-auto"
              onClick={() => (window.location.href = txPath)}
            >
              Open Proposal
            </Button>
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => {
                setSuccessUrl(null);
                setDescription("");
              }}
            >
              Create Another
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Create Proposal</CardTitle>
        </CardHeader>
        <CardContent>
          {!connected && (
            <Alert>
              <AlertDescription>
                Connect your wallet to create a proposal.
              </AlertDescription>
            </Alert>
          )}

          {connected && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Storage mode */}
              <div className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:flex-wrap sm:items-center">
                <Label className="shrink-0 text-sm font-medium">Storage:</Label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={mode === "url" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setMode("url")}
                  >
                    URL (no server)
                  </Button>
                  <Button
                    type="button"
                    variant={mode === "server" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setMode("server")}
                  >
                    Server
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground sm:ml-auto">
                  {mode === "url"
                    ? "All data in the link."
                    : "Stored on server."}
                </p>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  placeholder="What does this transaction do?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                />
              </div>

              {/* Entry Function selector */}
              <div className="space-y-4 rounded-md border p-4">
                <h3 className="text-sm font-medium">Entry Function</h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="moduleAddress">Module Address</Label>
                    <Input
                      id="moduleAddress"
                      placeholder="0x1"
                      value={moduleAddress}
                      onChange={(e) => setModuleAddress(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="moduleName">Module Name</Label>
                    <Input
                      id="moduleName"
                      placeholder="aptos_account"
                      value={moduleName}
                      onChange={(e) => setModuleName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="functionName">Function Name</Label>
                    <Input
                      id="functionName"
                      placeholder="transfer"
                      value={functionName}
                      onChange={(e) => setFunctionName(e.target.value)}
                      required
                    />
                  </div>
                </div>

                {/* ABI-driven parameter inputs */}
                <AbiFunctionForm
                  moduleAddress={moduleAddress.trim()}
                  moduleName={moduleName.trim()}
                  functionName={functionName.trim()}
                  onChange={handleAbiChange}
                  initialTypeArgs={initialTypeArgs}
                  initialArgs={initialArgs}
                />
              </div>

              {/* Gas & Expiration */}
              <div className="space-y-4 rounded-md border p-4">
                <h3 className="text-sm font-medium">Transaction Options</h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="maxGas">Max Gas</Label>
                    <Input
                      id="maxGas"
                      type="number"
                      min={1}
                      value={maxGas}
                      onChange={(e) => setMaxGas(Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="gasPrice">Gas Price</Label>
                    <Input
                      id="gasPrice"
                      type="number"
                      min={1}
                      value={gasPrice}
                      onChange={(e) => setGasPrice(Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="expirationHours">Expiration (hours)</Label>
                    <Input
                      id="expirationHours"
                      type="number"
                      min={1}
                      value={expirationHours}
                      onChange={(e) =>
                        setExpirationHours(Number(e.target.value))
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="feePayerAddress">
                    Fee Payer Address{" "}
                    <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="feePayerAddress"
                    placeholder="0x..."
                    value={feePayerAddress}
                    onChange={(e) => setFeePayerAddress(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <Label htmlFor="sequenceOverride">
                      Sequence Number{" "}
                      <span className="text-muted-foreground">
                        (optional — leave blank to auto-fetch)
                      </span>
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      On-chain:{" "}
                      <span className="font-mono text-foreground">
                        {onChainSeq !== null ? onChainSeq : "…"}
                      </span>
                      {onChainSeq !== null && (
                        <button
                          type="button"
                          className="ml-2 underline hover:text-foreground"
                          onClick={() =>
                            setSequenceOverride(String(onChainSeq))
                          }
                        >
                          use
                        </button>
                      )}
                    </span>
                  </div>
                  <Input
                    id="sequenceOverride"
                    type="number"
                    min={0}
                    step={1}
                    placeholder={
                      onChainSeq !== null
                        ? `auto = ${onChainSeq}`
                        : "auto-fetch from chain"
                    }
                    value={sequenceOverride}
                    onChange={(e) => setSequenceOverride(e.target.value)}
                  />
                  {onChainSeq !== null && (
                    <p className="text-xs text-muted-foreground">
                      To queue multiple proposals, give each a distinct sequence
                      starting at {onChainSeq} (e.g. {onChainSeq},{" "}
                      {onChainSeq + 1}, {onChainSeq + 2}, …). Only one tx per
                      sequence number can land on chain.
                    </p>
                  )}
                </div>
              </div>

              {/* Error */}
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* Actions */}
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                <Button type="submit" disabled={loading} className="flex-1">
                  {loading ? "Creating Proposal..." : "Create Proposal"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSimulate}
                  disabled={
                    simulating ||
                    !moduleAddress.trim() ||
                    !moduleName.trim() ||
                    !functionName.trim()
                  }
                  className="w-full sm:w-auto"
                >
                  {simulating ? "Simulating..." : "Simulate"}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Simulation results */}
      {(simulation || simError || simulating) && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Simulation</CardTitle>
              {simulating && <Badge variant="secondary">Simulating...</Badge>}
              {simulation && <SimulationStatusBadge simulation={simulation} />}
            </div>
            <CardDescription>
              Preview of what this transaction would do.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {simError && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">
                  {simError}
                </AlertDescription>
              </Alert>
            )}

            {simulation && (
              <SimulationResult simulation={simulation} textSize="text-sm" />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
