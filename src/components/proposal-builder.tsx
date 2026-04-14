"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/components/wallet-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { AptosNetwork } from "@/lib/aptos/client";

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
  const router = useRouter();

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
          "Module address, module name, and function name are required."
        );
      }

      // Get session token via wallet signature
      const token = await verifyIdentity();

      // Build the payload
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

      const body: Record<string, unknown> = {
        network,
        description: description.trim(),
        payload,
        maxGasAmount: maxGas,
        gasUnitPrice: gasPrice,
        expirationSeconds: expirationHours * 3600,
        source: "manual",
      };

      if (feePayerAddress.trim()) {
        body.feePayerAddress = feePayerAddress.trim();
      }

      const res = await fetch(
        `/api/multisig/${encodeURIComponent(multisigAddress)}/proposals`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to create proposal");
      }

      const data = await res.json();
      const fullUrl = `${window.location.origin}${data.url}`;
      setSuccessUrl(fullUrl);
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
              Your proposal has been created successfully. Share the link below
              with other signers to collect signatures.
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
            <Button onClick={() => router.push(txPath)}>
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
                  <span className="text-muted-foreground">(comma-separated, optional)</span>
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
                  <span className="text-muted-foreground">(comma-separated)</span>
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
