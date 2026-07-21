"use client";

import { useWallet as useAdapterWallet } from "@aptos-labs/wallet-adapter-react";
import { CheckCircle2, Clock, Copy, ExternalLink } from "lucide-react";
import { useCallback, useState } from "react";
import { AdminMultisigCreator } from "@/components/admin-multisig-creator";
import { ConnectWalletButton } from "@/components/connect-wallet-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWallet } from "@/components/wallet-provider";

const ADDRESS_REGEX = /^0x[0-9a-fA-F]{64}$/;

type Step = "configure" | "addresses" | "verify";

interface SetupData {
  id: string;
  addresses: string[];
  threshold: number;
  network: string;
  label: string | null;
  createdBy: string;
  status: string;
  multisigId: string | null;
  verifications: Array<{
    address: string;
    publicKey: string;
    verifiedAt: string;
  }>;
}

export function MultisigCreator() {
  const { isAdmin } = useWallet();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create New Multisig</CardTitle>
      </CardHeader>
      <CardContent>
        {isAdmin ? (
          <Tabs defaultValue="standard">
            <TabsList className="mb-4">
              <TabsTrigger value="standard">Standard</TabsTrigger>
              <TabsTrigger value="admin">Admin</TabsTrigger>
            </TabsList>
            <TabsContent value="standard">
              <StandardCreatorBody />
            </TabsContent>
            <TabsContent value="admin">
              <AdminMultisigCreator />
            </TabsContent>
          </Tabs>
        ) : (
          <StandardCreatorBody />
        )}
      </CardContent>
    </Card>
  );
}

function StandardCreatorBody() {
  const { connected, address, network } = useWallet();
  const adapter = useAdapterWallet();

  const [step, setStep] = useState<Step>("configure");
  const [numSigners, setNumSigners] = useState(3);
  const [threshold, setThreshold] = useState(2);
  const [label, setLabel] = useState("");
  const [signerAddresses, setSignerAddresses] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [setupData, setSetupData] = useState<SetupData | null>(null);
  const [copied, setCopied] = useState(false);

  // Step 1 -> Step 2
  function goToAddresses() {
    setError(null);
    if (threshold > numSigners) {
      setError("Threshold cannot exceed number of signers.");
      return;
    }
    // Initialize address slots (first is the connected wallet)
    const slots = Array.from({ length: numSigners - 1 }, () => "");
    setSignerAddresses(slots);
    setStep("addresses");
  }

  // Step 2 -> create setup
  async function createSetup() {
    setError(null);
    if (!address || !network) {
      setError("Wallet not connected.");
      return;
    }

    const allAddresses = [address, ...signerAddresses];

    // Validate all addresses
    for (let i = 0; i < allAddresses.length; i++) {
      if (!ADDRESS_REGEX.test(allAddresses[i])) {
        setError(`Signer #${i} has an invalid address.`);
        return;
      }
    }

    // Check for duplicates
    const unique = new Set(allAddresses.map((a) => a.toLowerCase()));
    if (unique.size !== allAddresses.length) {
      setError("Duplicate addresses are not allowed.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/multisig/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addresses: allAddresses,
          threshold,
          network,
          label: label || undefined,
          createdBy: address,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to create setup");
        setLoading(false);
        return;
      }

      const data = await res.json();
      // Fetch the full setup data
      const setupRes = await fetch(`/api/multisig/setup/${data.id}`);
      const setup = await setupRes.json();
      setSetupData(setup);
      setStep("verify");
    } catch {
      setError("Failed to create setup. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // Creator verification
  const verifyCreator = useCallback(async () => {
    if (!setupData || !address) return;
    setError(null);
    setLoading(true);

    try {
      const nonce = crypto.randomUUID();
      const signResult = await adapter.signMessage({
        message: `Verify signer for Aptos Multisig Setup\nSetup: ${setupData.id}`,
        nonce,
      });

      const signature = signResult.signature.toString();
      const fullMessage = signResult.fullMessage;

      const res = await fetch(`/api/multisig/setup/${setupData.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          publicKey: adapter.account?.publicKey?.toString(),
          signature,
          fullMessage,
          nonce,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Verification failed");
        setLoading(false);
        return;
      }

      // Refresh setup data
      const setupRes = await fetch(`/api/multisig/setup/${setupData.id}`);
      const updated = await setupRes.json();
      setSetupData(updated);
    } catch (err) {
      setError(`Verification failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [setupData, address, adapter]);

  // Refresh setup status
  const refreshStatus = useCallback(async () => {
    if (!setupData) return;
    try {
      const res = await fetch(`/api/multisig/setup/${setupData.id}`);
      const updated = await res.json();
      setSetupData(updated);
    } catch {
      // ignore refresh errors
    }
  }, [setupData]);

  function copyLink() {
    if (!setupData) return;
    const url = `${window.location.origin}/multisig/setup/${setupData.id}`;
    navigator.clipboard.writeText(url).catch(console.info);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function updateSignerAddress(index: number, value: string) {
    setSignerAddresses((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  const isCreatorVerified =
    setupData?.verifications?.some(
      (v) => v.address.toLowerCase() === address?.toLowerCase(),
    ) ?? false;

  return (
    <div className="space-y-6">
      {!connected && (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <p className="text-muted-foreground">
            Connect your Petra wallet to create a multisig. Your wallet will be
            added as the first signer.
          </p>
          <ConnectWalletButton />
        </div>
      )}

      {connected && step === "configure" && (
        <>
          <div className="space-y-2">
            <Label>Number of Signers</Label>
            <Select
              value={numSigners}
              onValueChange={(val) => {
                const n = Number(val);
                setNumSigners(n);
                if (threshold > n) setThreshold(n);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 9 }, (_, i) => i + 2).map((n) => (
                  <SelectItem key={n} value={n}>
                    {n} signers
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Threshold</Label>
            <Select
              value={threshold}
              onValueChange={(val) => setThreshold(Number(val))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: numSigners }, (_, i) => i + 1).map(
                  (n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              {threshold}-of-{numSigners} multisig
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="label">Label (optional)</Label>
            <Input
              id="label"
              placeholder="My team wallet"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button onClick={goToAddresses}>Next</Button>
        </>
      )}

      {connected && step === "addresses" && (
        <>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Signer #0 (your wallet)</Label>
              <Input
                value={address ?? ""}
                disabled
                className="font-mono text-xs"
              />
            </div>

            {signerAddresses.map((addr, index) => (
              <div key={index} className="space-y-2">
                <Label>Signer #{index + 1}</Label>
                <Input
                  placeholder="0x... (64 hex chars)"
                  value={addr}
                  onChange={(e) => updateSignerAddress(index, e.target.value)}
                  className={`font-mono text-xs ${addr && !ADDRESS_REGEX.test(addr) ? "border-red-500" : ""}`}
                />
              </div>
            ))}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setStep("configure")}
            >
              Back
            </Button>
            <Button
              onClick={createSetup}
              disabled={loading}
              className="w-full sm:w-auto"
            >
              {loading ? "Creating..." : "Create Setup"}
            </Button>
          </div>
        </>
      )}

      {connected && step === "verify" && setupData && (
        <>
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {setupData.threshold}-of-{setupData.addresses.length} multisig
              {setupData.label ? ` - ${setupData.label}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              Network: {setupData.network}
            </p>
          </div>

          {/* Creator verification */}
          {!isCreatorVerified && (
            <div className="space-y-2">
              <p className="text-sm">
                Sign to verify your identity as a signer.
              </p>
              <Button
                onClick={verifyCreator}
                disabled={loading}
                className="w-full sm:w-auto"
              >
                {loading ? "Signing..." : "Sign to Verify"}
              </Button>
            </div>
          )}

          {isCreatorVerified && (
            <>
              {/* Shareable link */}
              <div className="space-y-2">
                <Label>Share this link with other signers</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={`${typeof window !== "undefined" ? window.location.origin : ""}/multisig/setup/${setupData.id}`}
                    readOnly
                    className="min-w-0 flex-1 font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyLink}
                    className="w-full shrink-0 sm:w-auto"
                  >
                    {copied ? "Copied!" : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {/* Verification status */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>Signer Verification Status</Label>
                  <Button variant="outline" size="sm" onClick={refreshStatus}>
                    Refresh
                  </Button>
                </div>
                {setupData.addresses.map((addr: string, i: number) => {
                  const verified = setupData.verifications.some(
                    (v) => v.address.toLowerCase() === addr.toLowerCase(),
                  );
                  return (
                    <div
                      key={addr}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium">Signer #{i}</p>
                        <p className="break-all font-mono text-xs text-muted-foreground sm:truncate">
                          {addr}
                        </p>
                      </div>
                      {verified ? (
                        <Badge variant="default" className="ml-2 shrink-0">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          Verified
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="ml-2 shrink-0">
                          <Clock className="mr-1 h-3 w-3" />
                          Pending
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Complete state */}
              {setupData.status === "complete" && (
                <Alert>
                  <AlertDescription className="space-y-2">
                    <p className="font-medium">
                      All signers verified! Multisig created.
                    </p>
                    <a
                      href={`/multisig/setup/${setupData.id}`}
                      className="inline-flex items-center gap-1 text-sm underline"
                    >
                      Go to Dashboard <ExternalLink className="h-3 w-3" />
                    </a>
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
