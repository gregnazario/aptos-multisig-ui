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

const PUBLIC_KEY_REGEX = /^0x[0-9a-fA-F]{64}$/;

export function MultisigImporter() {
  const { network } = useWallet();
  const router = useRouter();

  const [keysText, setKeysText] = useState("");
  const [threshold, setThreshold] = useState(1);
  const [expectedAddress, setExpectedAddress] = useState("");
  const [derivedAddress, setDerivedAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [validated, setValidated] = useState(false);
  const [loading, setLoading] = useState(false);

  function parseKeys(): string[] {
    return keysText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async function validate() {
    setError(null);
    setWarning(null);
    setDerivedAddress(null);
    setValidated(false);

    const keys = parseKeys();

    if (keys.length < 2) {
      setError("At least 2 public keys are required.");
      return;
    }

    const invalidKeys = keys.filter((k) => !PUBLIC_KEY_REGEX.test(k));
    if (invalidKeys.length > 0) {
      setError(
        `Invalid public key format: ${invalidKeys[0]}. Keys must be 0x followed by 64 hex characters.`
      );
      return;
    }

    if (threshold < 1 || threshold > keys.length) {
      setError(`Threshold must be between 1 and ${keys.length}.`);
      return;
    }

    // Derive address via API
    try {
      const res = await fetch("/api/multisig/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKeys: keys, threshold }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to derive address");
        return;
      }

      const data = await res.json();
      setDerivedAddress(data.address);

      // Check against expected address
      if (
        expectedAddress &&
        expectedAddress.toLowerCase() !== data.address.toLowerCase()
      ) {
        setError(
          `Derived address does not match expected address.\nDerived: ${data.address}\nExpected: ${expectedAddress}`
        );
        return;
      }

      // On-chain verification
      if (network) {
        try {
          const infoRes = await fetch(
            `/api/multisig/verify-onchain?address=${data.address}&network=${network}`
          );
          if (infoRes.ok) {
            const infoData = await infoRes.json();
            if (infoData.warning) {
              setWarning(infoData.warning);
            }
          }
        } catch {
          // On-chain check is optional; proceed without warning
        }
      }

      setValidated(true);
    } catch {
      setError("Failed to validate. Please check your inputs.");
    }
  }

  async function importMultisig() {
    setError(null);
    setLoading(true);

    const keys = parseKeys();

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
          publicKeys: keys,
          threshold,
          network,
          expectedAddress: expectedAddress || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to import multisig");
        setLoading(false);
        return;
      }

      const data = await res.json();
      router.push(`/multisig/${data.address}?network=${network}`);
    } catch {
      setError("Failed to import multisig. Please try again.");
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import Existing Multisig</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Public keys textarea */}
        <div className="space-y-2">
          <Label htmlFor="publicKeys">Public Keys (one per line)</Label>
          <Textarea
            id="publicKeys"
            placeholder={"0xabc123...def456\n0x789abc...012def"}
            rows={6}
            value={keysText}
            onChange={(e) => {
              setKeysText(e.target.value);
              setValidated(false);
              setDerivedAddress(null);
            }}
            className="font-mono text-xs"
          />
        </div>

        {/* Threshold */}
        <div className="space-y-2">
          <Label htmlFor="threshold">Threshold</Label>
          <Input
            id="threshold"
            type="number"
            min={1}
            value={threshold}
            onChange={(e) => {
              setThreshold(Number(e.target.value));
              setValidated(false);
              setDerivedAddress(null);
            }}
          />
        </div>

        {/* Expected address */}
        <div className="space-y-2">
          <Label htmlFor="expectedAddress">Expected Address (optional)</Label>
          <Input
            id="expectedAddress"
            placeholder="0x..."
            value={expectedAddress}
            onChange={(e) => {
              setExpectedAddress(e.target.value);
              setValidated(false);
            }}
            className="font-mono text-xs"
          />
        </div>

        {/* Error display */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription className="whitespace-pre-wrap">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {/* Warning display */}
        {warning && (
          <Alert>
            <AlertDescription>{warning}</AlertDescription>
          </Alert>
        )}

        {/* Derived address */}
        {derivedAddress && !error && (
          <Alert>
            <AlertDescription>
              <span className="font-medium">Derived address:</span>{" "}
              <code className="text-xs break-all">{derivedAddress}</code>
            </AlertDescription>
          </Alert>
        )}

        {/* Actions */}
        <div className="flex gap-4">
          <Button variant="outline" onClick={validate}>
            Validate
          </Button>
          <Button onClick={importMultisig} disabled={!validated || loading}>
            {loading ? "Importing..." : "Import"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
