"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ConnectWalletButton } from "@/components/connect-wallet-button";
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
import { useWallet } from "@/components/wallet-provider";
import { encodeProposalUrl, type UrlProposalData } from "@/lib/url-state";

interface MultisigOption {
  id: string;
  address: string;
  publicKeys: string[];
  threshold: number;
  network: string;
  label: string | null;
}

export default function ProposePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <ProposeContent />
    </Suspense>
  );
}

function ProposeContent() {
  const searchParams = useSearchParams();
  const { connected, address, network } = useWallet();

  // Parse pre-filled transaction from URL params
  const moduleAddress = searchParams.get("module") ?? "";
  const moduleName = searchParams.get("name") ?? "";
  const functionName = searchParams.get("function") ?? "";
  const typeArgs = searchParams.get("type_args") ?? "";
  const args = searchParams.get("args") ?? "";
  const desc = searchParams.get("desc") ?? "";
  const maxGas = Number(searchParams.get("max_gas") ?? "10000");
  const gasPrice = Number(searchParams.get("gas_price") ?? "100");
  const expHours = Number(searchParams.get("exp_hours") ?? "24");

  const hasPayload = moduleAddress && moduleName && functionName;
  const fullFunction = hasPayload
    ? `${moduleAddress}::${moduleName}::${functionName}`
    : "";

  const [multisigs, setMultisigs] = useState<MultisigOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMultisig, setSelectedMultisig] =
    useState<MultisigOption | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successUrl, setSuccessUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Simulation
  const [simulating, setSimulating] = useState(false);
  const [simulation, setSimulation] = useState<{
    success: boolean;
    vmStatus: string;
    gasUsed: string;
    events: { type: string; data: unknown }[];
    changes: { type: string; address?: string; resource?: string }[];
  } | null>(null);
  const [simError, setSimError] = useState<string | null>(null);

  // Fetch user's multisigs when wallet connects
  useEffect(() => {
    if (!connected || !address) {
      setMultisigs([]);
      return;
    }

    setLoading(true);
    fetch(
      `/api/multisig/by-signer?address=${encodeURIComponent(address)}&network=${network}`,
    )
      .then((r) => r.json())
      .then((data) => {
        setMultisigs(data.multisigs ?? []);
        // Auto-select if only one
        if (data.multisigs?.length === 1) {
          setSelectedMultisig(data.multisigs[0]);
        }
      })
      .catch(() => setMultisigs([]))
      .finally(() => setLoading(false));
  }, [connected, address, network]);

  // Auto-simulate when multisig is selected
  useEffect(() => {
    if (!selectedMultisig || !hasPayload) {
      setSimulation(null);
      setSimError(null);
      return;
    }

    const payload = {
      module: `${moduleAddress}::${moduleName}`,
      function: functionName,
      typeArgs: typeArgs
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      args: args
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };

    setSimulating(true);
    setSimulation(null);
    setSimError(null);

    fetch("/api/multisig/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        multisigAddress: selectedMultisig.address,
        network,
        payload,
        maxGasAmount: maxGas,
        gasUnitPrice: gasPrice,
      }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          setSimError(data.error ?? "Simulation failed");
        } else {
          setSimulation(data);
        }
      })
      .catch((err) => {
        setSimError(err instanceof Error ? err.message : "Simulation failed");
      })
      .finally(() => setSimulating(false));
  }, [
    selectedMultisig,
    hasPayload,
    moduleAddress,
    moduleName,
    functionName,
    typeArgs,
    args,
    network,
    maxGas,
    gasPrice,
  ]);

  async function handleCreate() {
    if (!selectedMultisig || !hasPayload) return;
    setCreating(true);
    setError(null);

    try {
      const payload = {
        module: `${moduleAddress}::${moduleName}`,
        function: functionName,
        typeArgs: typeArgs
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        args: args
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };

      // Build the transaction
      const buildRes = await fetch("/api/multisig/build-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          multisigAddress: selectedMultisig.address,
          network,
          payload,
          maxGasAmount: maxGas,
          gasUnitPrice: gasPrice,
          expirationSeconds: expHours * 3600,
        }),
      });

      if (!buildRes.ok) {
        const data = await buildRes.json();
        throw new Error(data.error ?? "Failed to build transaction");
      }

      const built = await buildRes.json();

      // Encode as URL proposal
      const urlData: UrlProposalData = {
        pks: selectedMultisig.publicKeys,
        th: selectedMultisig.threshold,
        net: network,
        tx: built.rawTransactionBytes,
        desc: desc || `${fullFunction}`,
        fn: fullFunction,
        args: payload.args.length > 0 ? payload.args : undefined,
        seq: built.sequenceNumber,
        exp: built.expirationTimestampSecs,
        gas: built.maxGasAmount,
        gasPrice: built.gasUnitPrice,
        sigs: [],
      };

      const urlPath = encodeProposalUrl(urlData);
      setSuccessUrl(`${window.location.origin}${urlPath}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create proposal",
      );
    } finally {
      setCreating(false);
    }
  }

  if (successUrl) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-6 py-2 sm:py-4">
        <Card>
          <CardHeader>
            <CardTitle>Proposal Created</CardTitle>
            <CardDescription>
              Share this link with signers to collect signatures.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={successUrl}
                readOnly
                className="min-w-0 flex-1 font-mono text-xs"
              />
              <Button
                variant="outline"
                className="w-full shrink-0 sm:w-auto"
                onClick={() => {
                  navigator.clipboard.writeText(successUrl).catch(console.info);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? "Copied!" : "Copy"}
              </Button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
              <Button
                className="w-full sm:w-auto"
                onClick={() =>
                  (window.location.href = successUrl.replace(
                    window.location.origin,
                    "",
                  ))
                }
              >
                Open Proposal
              </Button>
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => setSuccessUrl(null)}
              >
                Create Another
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 py-2 sm:py-4">
      <div className="space-y-2">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          Propose Transaction
        </h1>
        <p className="text-muted-foreground">
          {hasPayload
            ? "Review the pre-filled transaction below and choose which multisig to propose it from."
            : "No transaction payload found in the URL. Add query parameters to pre-fill a proposal."}
        </p>
      </div>

      {/* Transaction preview */}
      {hasPayload && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transaction</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="font-medium">Function: </span>
              <code className="break-all text-xs">{fullFunction}</code>
            </div>
            {typeArgs && (
              <div>
                <span className="font-medium">Type Arguments: </span>
                <code className="break-all text-xs">{typeArgs}</code>
              </div>
            )}
            {args && (
              <div>
                <span className="font-medium">Arguments: </span>
                <code className="break-all text-xs">{args}</code>
              </div>
            )}
            {desc && (
              <div>
                <span className="font-medium">Description: </span>
                {desc}
              </div>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>Max Gas: {maxGas}</span>
              <span>Gas Price: {gasPrice}</span>
              <span>Expires: {expHours}h</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Wallet connection */}
      {!connected && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
            <p className="text-muted-foreground">
              Connect your wallet to see your multisigs and create a proposal.
            </p>
            <ConnectWalletButton />
          </CardContent>
        </Card>
      )}

      {/* Multisig selector */}
      {connected && hasPayload && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Choose Multisig</CardTitle>
            <CardDescription>
              Select which multisig account should execute this transaction.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading && (
              <p className="text-sm text-muted-foreground">
                Loading your multisigs...
              </p>
            )}

            {!loading && multisigs.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No multisigs found for your wallet on {network}. Create or
                import one first.
              </p>
            )}

            {multisigs.map((ms) => (
              <button
                type="button"
                key={ms.id}
                onClick={() => setSelectedMultisig(ms)}
                className={`w-full text-left rounded-lg border p-3 transition-colors ${
                  selectedMultisig?.id === ms.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {ms.label ?? "Multisig"}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {ms.address.slice(0, 10)}...{ms.address.slice(-8)}
                    </p>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {ms.threshold}-of-{ms.publicKeys.length}
                  </Badge>
                </div>
              </button>
            ))}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              onClick={handleCreate}
              disabled={!selectedMultisig || creating}
              className="w-full"
            >
              {creating ? "Creating..." : "Create Proposal"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Simulation results */}
      {selectedMultisig && hasPayload && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Simulation</CardTitle>
              {simulating && <Badge variant="secondary">Simulating...</Badge>}
              {simulation && (
                <Badge
                  className={
                    simulation.success
                      ? "bg-green-600 text-white"
                      : "bg-red-600 text-white"
                  }
                >
                  {simulation.success ? "Success" : "Failed"}
                </Badge>
              )}
            </div>
            <CardDescription>
              Preview of what this transaction would do when executed by{" "}
              {selectedMultisig.label ??
                `${selectedMultisig.address.slice(0, 10)}...`}
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
              <>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Status: </span>
                    <span
                      className={
                        simulation.success ? "text-green-600" : "text-red-600"
                      }
                    >
                      {simulation.vmStatus}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Gas Used: </span>
                    {simulation.gasUsed}
                  </div>
                </div>

                {simulation.events.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">
                      Events ({simulation.events.length})
                    </p>
                    <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/50 p-2 space-y-2">
                      {simulation.events.map((event, i) => (
                        <div key={i} className="text-xs">
                          <code className="break-all font-medium text-primary">
                            {event.type}
                          </code>
                          <pre className="mt-1 overflow-x-auto text-muted-foreground">
                            {JSON.stringify(event.data, null, 2)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {simulation.changes.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">
                      State Changes ({simulation.changes.length})
                    </p>
                    <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border bg-muted/50 p-2">
                      {simulation.changes.map((change, i) => (
                        <div key={i} className="text-xs">
                          <Badge variant="outline" className="mr-1 text-[10px]">
                            {change.type}
                          </Badge>
                          {change.resource && (
                            <code className="break-all text-muted-foreground">
                              {change.resource}
                            </code>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* URL format documentation */}
      {!hasPayload && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">URL Format</CardTitle>
            <CardDescription>
              External tools can link here with query parameters to pre-fill a
              proposal.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Parameters</Label>
              <div className="rounded-md border p-3 bg-muted/50 text-xs font-mono space-y-1">
                <p>
                  <strong>module</strong> — module address (e.g., 0x1)
                </p>
                <p>
                  <strong>name</strong> — module name (e.g., aptos_account)
                </p>
                <p>
                  <strong>function</strong> — function name (e.g., transfer)
                </p>
                <p>
                  <strong>args</strong> — comma-separated arguments
                </p>
                <p>
                  <strong>type_args</strong> — comma-separated type arguments
                  (optional)
                </p>
                <p>
                  <strong>desc</strong> — human-readable description (optional)
                </p>
                <p>
                  <strong>max_gas</strong> — max gas amount (default: 10000)
                </p>
                <p>
                  <strong>gas_price</strong> — gas unit price (default: 100)
                </p>
                <p>
                  <strong>exp_hours</strong> — expiration in hours (default: 24)
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Example</Label>
              <code className="block rounded-md border p-3 bg-muted/50 text-xs break-all">
                /propose?module=0x1&name=aptos_account&function=transfer&args=0xrecipient,100000000&desc=Send+1+APT
              </code>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
