"use client";

import { useWallet as useAdapterWallet } from "@aptos-labs/wallet-adapter-react";
import { CheckCircle2, Clock, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ConnectWalletButton } from "@/components/connect-wallet-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useWallet } from "@/components/wallet-provider";

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

export function SetupVerifier({ setupId }: { setupId: string }) {
  const { connected, address } = useWallet();
  const adapter = useAdapterWallet();

  const [setupData, setSetupData] = useState<SetupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [multisigAddress, setMultisigAddress] = useState<string | null>(null);

  const fetchSetup = useCallback(async () => {
    try {
      const res = await fetch(`/api/multisig/setup/${setupId}`);
      if (!res.ok) {
        setError("Setup not found");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setSetupData(data);
    } catch {
      setError("Failed to load setup");
    } finally {
      setLoading(false);
    }
  }, [setupId]);

  useEffect(() => {
    fetchSetup().catch(console.error);
  }, [fetchSetup]);

  const isSignerInSetup =
    setupData && address
      ? setupData.addresses.some(
          (a) => a.toLowerCase() === address.toLowerCase(),
        )
      : false;

  const isAlreadyVerified =
    setupData && address
      ? setupData.verifications.some(
          (v) => v.address.toLowerCase() === address.toLowerCase(),
        )
      : false;

  const canVerify =
    isSignerInSetup && !isAlreadyVerified && setupData?.status === "pending";

  async function verify() {
    if (!setupData || !address) return;
    setError(null);
    setVerifying(true);

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
        setVerifying(false);
        return;
      }

      const result = await res.json();
      if (result.multisigAddress) {
        setMultisigAddress(result.multisigAddress);
      }

      // Refresh setup data
      await fetchSetup();
    } catch (err) {
      setError(`Verification failed: ${(err as Error).message}`);
    } finally {
      setVerifying(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Loading setup...</p>
        </CardContent>
      </Card>
    );
  }

  if (error && !setupData) {
    return (
      <Card>
        <CardContent className="py-8">
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!setupData) return null;

  const verifiedCount = setupData.verifications.length;
  const totalCount = setupData.addresses.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Multisig Setup Verification</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Setup info */}
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {setupData.threshold}-of-{totalCount} multisig
            {setupData.label ? ` - ${setupData.label}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            Network: {setupData.network}
          </p>
          <p className="text-xs text-muted-foreground">
            {verifiedCount} of {totalCount} signers verified
          </p>
        </div>

        {/* Signer list */}
        <div className="space-y-3">
          <Label>Signers</Label>
          {setupData.addresses.map((addr: string, i: number) => {
            const verified = setupData.verifications.some(
              (v) => v.address.toLowerCase() === addr.toLowerCase(),
            );
            const isCurrentUser =
              address && addr.toLowerCase() === address.toLowerCase();
            return (
              <div
                key={addr}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 ${isCurrentUser ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">
                    Signer #{i}
                    {isCurrentUser ? " (you)" : ""}
                  </p>
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

        {/* Connect wallet prompt */}
        {!connected && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <p className="text-sm text-muted-foreground">
              Connect your Petra wallet to verify your identity as a signer.
            </p>
            <ConnectWalletButton />
          </div>
        )}

        {/* Verification action */}
        {connected && canVerify && (
          <div className="space-y-2">
            <p className="text-sm">
              Your wallet matches a signer in this setup. Sign a message to
              verify your identity.
            </p>
            <Button
              onClick={verify}
              disabled={verifying}
              className="w-full sm:w-auto"
            >
              {verifying ? "Signing..." : "Sign to Verify"}
            </Button>
          </div>
        )}

        {connected &&
          isSignerInSetup &&
          isAlreadyVerified &&
          setupData.status === "pending" && (
            <Alert>
              <AlertDescription>
                You have already verified. Waiting for other signers to verify.
              </AlertDescription>
            </Alert>
          )}

        {connected && !isSignerInSetup && (
          <Alert>
            <AlertDescription>
              Your connected wallet address is not part of this multisig setup.
              Please connect the correct wallet.
            </AlertDescription>
          </Alert>
        )}

        {/* Error */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Complete state */}
        {setupData.status === "complete" && (
          <Alert>
            <AlertDescription className="space-y-2">
              <p className="font-medium">
                All signers verified! Multisig has been created.
              </p>
              {multisigAddress && (
                <p className="font-mono text-xs break-all">
                  Multisig address: {multisigAddress}
                </p>
              )}
              <a
                href={`/multisig/${multisigAddress ?? ""}?network=${setupData.network}`}
                className="inline-flex items-center gap-1 text-sm underline"
              >
                Go to Dashboard <ExternalLink className="h-3 w-3" />
              </a>
            </AlertDescription>
          </Alert>
        )}

        {/* Refresh button */}
        {setupData.status === "pending" && (
          <Button variant="outline" size="sm" onClick={fetchSetup}>
            Refresh Status
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
