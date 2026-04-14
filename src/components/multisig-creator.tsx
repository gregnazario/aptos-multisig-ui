"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/components/wallet-provider";
import { ConnectWalletButton } from "@/components/connect-wallet-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

const PUBLIC_KEY_REGEX = /^0x[0-9a-fA-F]{64}$/;

export function MultisigCreator() {
  const { connected, address, publicKey, network } = useWallet();
  const router = useRouter();

  const [additionalKeys, setAdditionalKeys] = useState<string[]>([""]);
  const [threshold, setThreshold] = useState(1);
  const [label, setLabel] = useState("");
  const [derivedAddress, setDerivedAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const allKeys = publicKey ? [publicKey, ...additionalKeys.filter(Boolean)] : [];
  const validKeys = allKeys.filter((k) => PUBLIC_KEY_REGEX.test(k));
  const maxThreshold = validKeys.length;

  function addKeyField() {
    setAdditionalKeys((prev) => [...prev, ""]);
  }

  function removeKeyField(index: number) {
    setAdditionalKeys((prev) => prev.filter((_, i) => i !== index));
  }

  function updateKey(index: number, value: string) {
    setAdditionalKeys((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    setDerivedAddress(null);
  }

  async function previewAddress() {
    setError(null);
    setDerivedAddress(null);

    if (validKeys.length < 2) {
      setError("At least 2 valid public keys are required.");
      return;
    }
    if (threshold < 1 || threshold > maxThreshold) {
      setError(`Threshold must be between 1 and ${maxThreshold}.`);
      return;
    }

    try {
      const res = await fetch("/api/multisig/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKeys: validKeys, threshold }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to derive address");
        return;
      }
      const data = await res.json();
      setDerivedAddress(data.address);
    } catch {
      setError("Failed to derive address. Please check your inputs.");
    }
  }

  async function createMultisig() {
    setError(null);
    setLoading(true);

    if (validKeys.length < 2) {
      setError("At least 2 valid public keys are required.");
      setLoading(false);
      return;
    }
    if (!network) {
      setError("Wallet not connected or network unavailable.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/multisig", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicKeys: validKeys,
          threshold,
          network,
          label: label || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to create multisig");
        setLoading(false);
        return;
      }

      const data = await res.json();
      router.push(`/multisig/${data.address}?network=${network}`);
    } catch {
      setError("Failed to create multisig. Please try again.");
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create New Multisig</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {!connected && (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <p className="text-muted-foreground">
              Connect your Petra wallet to create a multisig. Your wallet will be
              added as the first signer.
            </p>
            <ConnectWalletButton />
          </div>
        )}

        {connected && publicKey && (
          <>
            {/* Signer #0 - connected wallet */}
            <div className="space-y-2">
              <Label>Signer #0 (your wallet)</Label>
              {address && (
                <p className="text-xs text-muted-foreground">
                  Address: <code>{address}</code>
                </p>
              )}
              <Input value={publicKey} disabled className="font-mono text-xs" />
              <p className="text-xs text-muted-foreground">
                This is your Ed25519 public key, which differs from your account address.
                Multisig accounts are derived from public keys.
              </p>
            </div>

            {/* Additional signers */}
            <div className="space-y-2">
              <Label>Additional Signers</Label>
              {additionalKeys.map((key, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    placeholder="0x... (64 hex chars)"
                    value={key}
                    onChange={(e) => updateKey(index, e.target.value)}
                    className={`font-mono text-xs ${key && !PUBLIC_KEY_REGEX.test(key) ? "border-red-500" : ""}`}
                  />
                  {additionalKeys.length > 1 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => removeKeyField(index)}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addKeyField}>
                + Add Signer
              </Button>
            </div>

            {/* Threshold */}
            <div className="space-y-2">
              <Label htmlFor="threshold">
                Threshold (min 1, max {maxThreshold || "N"})
              </Label>
              <Input
                id="threshold"
                type="number"
                min={1}
                max={maxThreshold || 1}
                value={threshold}
                onChange={(e) => {
                  setThreshold(Number(e.target.value));
                  setDerivedAddress(null);
                }}
              />
            </div>

            {/* Optional label */}
            <div className="space-y-2">
              <Label htmlFor="label">Label (optional)</Label>
              <Input
                id="label"
                placeholder="My team wallet"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>

            {/* Error display */}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Derived address */}
            {derivedAddress && (
              <Alert>
                <AlertDescription>
                  <span className="font-medium">Derived address:</span>{" "}
                  <code className="text-xs break-all">{derivedAddress}</code>
                </AlertDescription>
              </Alert>
            )}

            {/* Actions */}
            <div className="flex gap-4">
              <Button variant="outline" onClick={previewAddress}>
                Preview Address
              </Button>
              <Button onClick={createMultisig} disabled={loading}>
                {loading ? "Creating..." : "Create Multisig"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
