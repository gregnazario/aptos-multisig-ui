"use client";

import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useWallet } from "@/components/wallet-provider";
import type { AptosNetwork } from "@/lib/aptos/client";
import { type UrlProposalData, encodeProposalUrl } from "@/lib/url-state";

type StorageMode = "url" | "server";

interface ProposalBuilderProps {
  multisigAddress: string;
  network: AptosNetwork;
  threshold: number;
  publicKeys: string[];
}

export function ProposalBuilder({
  multisigAddress,
  network,
  threshold,
  publicKeys,
}: ProposalBuilderProps) {
  const { connected, verifyIdentity } = useWallet();

  const [mode, setMode] = useState<StorageMode>("url");
  const [description, setDescription] = useState("");
  const [moduleAddress, setModuleAddress] = useState("0x1");
  const [moduleName, setModuleName] = useState("aptos_account");
  const [functionName, setFunctionName] = useState("transfer");
  const [typeArgs, setTypeArgs] = useState("");
  const [functionArgs, setFunctionArgs] = useState("");
  const [maxGas, setMaxGas] = useState(10000);
  const [gasPrice, setGasPrice] = useState(100);
  const [expirationHours, setExpirationHours] = useState(24);
  const [feePayerAddress, setFeePayerAddress] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successUrl, setSuccessUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessUrl(null);
    setLoading(true);

    try {
      // Validate required fields
      if (!description.trim()) {
        throw new Error("Description is required.");
      }
      if (!moduleAddress.trim() || !moduleName.trim() || !functionName.trim()) {
        throw new Error(
          "Module address, module name, and function name are required.",
        );
      }

      const payload = {
        module: `${moduleAddress.trim()}::${moduleName.trim()}`,
        function: functionName.trim(),
        typeArgs: typeArgs
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        args: functionArgs
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };

      // Build the transaction server-side
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
        }),
      });

      if (!buildRes.ok) {
        const errData = await buildRes.json();
        throw new Error(errData.error ?? "Failed to build transaction");
      }

      const built = await buildRes.json();

      if (mode === "url") {
        // URL mode: encode everything into a shareable URL — no DB
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
        const fullUrl = `${window.location.origin}${urlPath}`;
        setSuccessUrl(fullUrl);
      } else {
        // Server mode: store in database
        const token = await verifyIdentity();

        const res = await fetch(
          `/api/multisig/${encodeURIComponent(multisigAddress)}/proposals`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              network,
              description: description.trim(),
              payload,
              maxGasAmount: maxGas,
              gasUnitPrice: gasPrice,
              expirationSeconds: expirationHours * 3600,
              feePayerAddress: feePayerAddress.trim() || undefined,
              source: "manual",
            }),
          },
        );

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error ?? "Failed to create proposal");
        }

        const data = await res.json();
        const fullUrl = `${window.location.origin}${data.url}`;
        setSuccessUrl(fullUrl);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred.";
      setError(message);
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
    } catch {
      // Fallback: select text in a temporary input
    }
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
              Share this link with signers. All proposal data is encoded in the
              URL — no server storage needed. Each signer opens the link, signs,
              and gets an updated URL with their signature to pass along.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label>Shareable Link</Label>
            <div className="flex gap-2">
              <Input
                value={successUrl}
                readOnly
                className="font-mono text-xs"
              />
              <Button variant="outline" onClick={copyToClipboard}>
                {copied ? "Copied!" : "Copy"}
              </Button>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            {threshold}-of-{publicKeys.length} signatures required to execute.
          </p>

          <div className="flex gap-3">
            <Button onClick={() => (window.location.href = txPath)}>
              Open Proposal
            </Button>
            <Button
              variant="outline"
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
    <Card>
      <CardHeader>
        <CardTitle>Create Proposal</CardTitle>
      </CardHeader>
      <CardContent>
        {!connected && (
          <Alert>
            <AlertDescription>
              Please connect your wallet to create a proposal.
            </AlertDescription>
          </Alert>
        )}

        {connected && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Storage mode */}
            <div className="flex items-center gap-3 rounded-md border p-3">
              <Label className="text-sm font-medium shrink-0">Storage:</Label>
              <div className="flex gap-2">
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
              <p className="text-xs text-muted-foreground">
                {mode === "url"
                  ? "All data encoded in the link. No database needed."
                  : "Stored on server. Better for large payloads."}
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

            {/* Entry Function */}
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

              <div className="space-y-2">
                <Label htmlFor="typeArgs">
                  Type Arguments{" "}
                  <span className="text-muted-foreground">
                    (comma-separated, optional)
                  </span>
                </Label>
                <Input
                  id="typeArgs"
                  placeholder="0x1::aptos_coin::AptosCoin"
                  value={typeArgs}
                  onChange={(e) => setTypeArgs(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="functionArgs">
                  Function Arguments{" "}
                  <span className="text-muted-foreground">
                    (comma-separated)
                  </span>
                </Label>
                <Input
                  id="functionArgs"
                  placeholder="0xrecipient, 1000000"
                  value={functionArgs}
                  onChange={(e) => setFunctionArgs(e.target.value)}
                />
              </div>
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
                    onChange={(e) => setExpirationHours(Number(e.target.value))}
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
            </div>

            {/* Error */}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Submit */}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Creating Proposal..." : "Create Proposal"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
