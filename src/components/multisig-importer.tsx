"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useWallet } from "@/components/wallet-provider";

const PUBLIC_KEY_REGEX = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_REGEX = /^0x[0-9a-fA-F]{1,64}$/;

// ── Lookup by Address ─────────────────────────────────────────────────

function LookupImporter() {
  const { network, connected, verifyIdentity } = useWallet();
  const router = useRouter();

  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<{
    address: string;
    publicKeys: string[];
    threshold: number;
    sourceTxn: string;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [skipVerification, setSkipVerification] = useState(false);

  async function handleLookup() {
    setError(null);
    setLookupResult(null);
    setLoading(true);

    if (!ADDRESS_REGEX.test(address.trim())) {
      setError("Invalid Aptos address format.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(
        `/api/multisig/lookup?address=${encodeURIComponent(address.trim())}&network=${network}`,
      );
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Lookup failed");
        return;
      }

      setLookupResult(data);
    } catch {
      setError("Lookup failed. Please check the address and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!lookupResult) return;
    setError(null);
    setImporting(true);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (!skipVerification) {
        const token = await verifyIdentity();
        headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch("/api/multisig", {
        method: "POST",
        headers,
        body: JSON.stringify({
          publicKeys: lookupResult.publicKeys,
          threshold: lookupResult.threshold,
          network,
          expectedAddress: lookupResult.address,
          skipVerification: skipVerification || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to import");
        setImporting(false);
        return;
      }

      const data = await res.json();
      router.push(`/multisig/${data.address}?network=${network}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="lookupAddress">Multisig Address</Label>
        <div className="flex gap-2">
          <Input
            id="lookupAddress"
            placeholder="0x..."
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setLookupResult(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && handleLookup()}
            className="font-mono text-xs"
          />
          <Button onClick={handleLookup} disabled={loading || !address.trim()}>
            {loading ? "Looking up..." : "Lookup"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The account must have sent at least one transaction so we can extract
          its public keys from the on-chain authenticator.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {lookupResult && (
        <div className="space-y-4">
          <Alert>
            <AlertDescription className="space-y-2">
              <p className="font-medium">
                Found {lookupResult.threshold}-of-
                {lookupResult.publicKeys.length} MultiEd25519 multisig
              </p>
              <p className="text-xs text-muted-foreground">
                Source transaction:{" "}
                <a
                  href={`https://explorer.aptoslabs.com/txn/${lookupResult.sourceTxn}?network=${network}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {lookupResult.sourceTxn?.slice(0, 16)}...
                </a>
              </p>
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label>Public Keys ({lookupResult.publicKeys.length})</Label>
            <div className="space-y-1 rounded-md border p-3 bg-muted/50">
              {lookupResult.publicKeys.map((key, i) => (
                <p key={i} className="text-xs font-mono break-all">
                  <span className="text-muted-foreground">#{i}: </span>
                  {key}
                </p>
              ))}
            </div>
          </div>

          <div className="text-sm">
            <span className="font-medium">Threshold: </span>
            {lookupResult.threshold} of {lookupResult.publicKeys.length}
          </div>

          <label className="flex items-start gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={skipVerification}
              onChange={(e) => setSkipVerification(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">
                Skip signer verification (read-only)
              </span>
              <span className="block text-muted-foreground">
                Register an existing on-chain multisig without proving you are a
                signer. Use for tracking multisigs you don&apos;t control.
              </span>
            </span>
          </label>

          <Button
            onClick={handleImport}
            disabled={importing || (!skipVerification && !connected)}
            title={
              !skipVerification && !connected
                ? "Connect a signer wallet to import"
                : undefined
            }
          >
            {importing
              ? "Importing..."
              : skipVerification
                ? "Import (no verification)"
                : connected
                  ? "Sign to Import"
                  : "Connect Wallet to Import"}
          </Button>
          {!skipVerification && !connected && (
            <p className="text-xs text-muted-foreground">
              Import requires a signature from one of the signers, to prove
              ownership before registering the multisig.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Manual Import (existing) ──────────────────────────────────────────

function ManualImporter() {
  const { network, connected, verifyIdentity } = useWallet();
  const router = useRouter();

  const [keysText, setKeysText] = useState("");
  const [threshold, setThreshold] = useState(1);
  const [expectedAddress, setExpectedAddress] = useState("");
  const [derivedAddress, setDerivedAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [validated, setValidated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [skipVerification, setSkipVerification] = useState(false);

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
        `Invalid public key format: ${invalidKeys[0]}. Keys must be 0x followed by 64 hex characters.`,
      );
      return;
    }

    if (threshold < 1 || threshold > keys.length) {
      setError(`Threshold must be between 1 and ${keys.length}.`);
      return;
    }

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

      if (
        expectedAddress &&
        expectedAddress.toLowerCase() !== data.address.toLowerCase()
      ) {
        setError(
          `Derived address does not match expected address.\nDerived: ${data.address}\nExpected: ${expectedAddress}`,
        );
        return;
      }

      if (network) {
        try {
          const infoRes = await fetch(
            `/api/multisig/verify-onchain?address=${data.address}&network=${network}`,
          );
          if (infoRes.ok) {
            const infoData = await infoRes.json();
            if (infoData.warning) {
              setWarning(infoData.warning);
            }
          }
        } catch {
          // optional check
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

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (!skipVerification) {
        const token = await verifyIdentity();
        headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch("/api/multisig", {
        method: "POST",
        headers,
        body: JSON.stringify({
          publicKeys: keys,
          threshold,
          network,
          expectedAddress: expectedAddress || undefined,
          skipVerification: skipVerification || undefined,
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
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to import multisig. Please try again.",
      );
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
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

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="whitespace-pre-wrap">
            {error}
          </AlertDescription>
        </Alert>
      )}

      {warning && (
        <Alert>
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      )}

      {derivedAddress && !error && (
        <Alert>
          <AlertDescription>
            <span className="font-medium">Derived address:</span>{" "}
            <code className="text-xs break-all">{derivedAddress}</code>
          </AlertDescription>
        </Alert>
      )}

      <label className="flex items-start gap-2 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={skipVerification}
          onChange={(e) => setSkipVerification(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">
            Skip signer verification (read-only)
          </span>
          <span className="block text-muted-foreground">
            Register an existing on-chain multisig without proving you are a
            signer. Use for tracking multisigs you don&apos;t control.
          </span>
        </span>
      </label>

      <div className="flex gap-4">
        <Button variant="outline" onClick={validate}>
          Validate
        </Button>
        <Button
          onClick={importMultisig}
          disabled={!validated || loading || (!skipVerification && !connected)}
          title={
            !skipVerification && !connected
              ? "Connect a signer wallet to import"
              : undefined
          }
        >
          {loading
            ? "Importing..."
            : skipVerification
              ? "Import (no verification)"
              : connected
                ? "Sign to Import"
                : "Connect Wallet to Import"}
        </Button>
      </div>
      {!skipVerification && !connected && validated && (
        <p className="text-xs text-muted-foreground">
          Import requires a signature from one of the signers, to prove
          ownership before registering the multisig.
        </p>
      )}
    </div>
  );
}

// ── Main Importer with Tabs ───────────────────────────────────────────

export function MultisigImporter() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Import Existing Multisig</CardTitle>
        <CardDescription>
          Import a multisig by looking up its address on-chain, or by manually
          providing the public keys and threshold.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="lookup">
          <TabsList className="mb-4">
            <TabsTrigger value="lookup">Lookup by Address</TabsTrigger>
            <TabsTrigger value="manual">Manual Import</TabsTrigger>
          </TabsList>
          <TabsContent value="lookup">
            <LookupImporter />
          </TabsContent>
          <TabsContent value="manual">
            <ManualImporter />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
