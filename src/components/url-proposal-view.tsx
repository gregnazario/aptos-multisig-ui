"use client";

import { useWallet as useAdapterWallet } from "@aptos-labs/wallet-adapter-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { OfflineSigningPanel } from "@/components/offline-signing-panel";
import { SignerStatusGrid } from "@/components/signer-status-grid";
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
import { useWallet } from "@/components/wallet-provider";
import type { AptosNetwork } from "@/lib/aptos/client";
import { deriveMultisigAddress } from "@/lib/aptos/multisig";
import {
  extractEd25519SignatureHex,
  findSignerIndex,
} from "@/lib/aptos/signing";
import {
  addSignatureToUrl,
  decodeProposalUrl,
  hasSignerSigned,
  hasThreshold,
  type UrlProposalData,
} from "@/lib/url-state";

export function UrlProposalView() {
  const { connected, publicKey, network: walletNetwork } = useWallet();
  const adapter = useAdapterWallet();

  const [data, setData] = useState<UrlProposalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    txHash?: string;
    error?: string;
  } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [updatedUrl, setUpdatedUrl] = useState<string | null>(null);

  // Parse data from URL hash on mount
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || hash === "#") {
      setError("No proposal data found in URL.");
      return;
    }
    const decoded = decodeProposalUrl(hash);
    if (!decoded) {
      setError("Invalid proposal data in URL.");
      return;
    }
    setData(decoded);
  }, []);

  const multisigAddress = useMemo(() => {
    if (!data) return null;
    try {
      return deriveMultisigAddress(data.pks, data.th).address;
    } catch {
      return null;
    }
  }, [data]);

  const now = Math.floor(Date.now() / 1000);
  const isExpired = data ? data.exp < now : false;
  const thresholdMet = data ? hasThreshold(data) : false;

  const signerIndex =
    data && publicKey ? findSignerIndex(data.pks, publicKey) : -1;
  const isSigner = signerIndex >= 0;
  const alreadySigned = data ? hasSignerSigned(data, signerIndex) : false;
  const networkMatches = data
    ? walletNetwork?.toLowerCase() === data.net.toLowerCase()
    : false;

  const canSign =
    connected &&
    isSigner &&
    !alreadySigned &&
    !isExpired &&
    !thresholdMet &&
    networkMatches;

  const handleSign = useCallback(async () => {
    if (!data || signerIndex < 0) return;
    setSigning(true);
    setError(null);

    try {
      const { SimpleTransaction, Deserializer } = await import(
        "@aptos-labs/ts-sdk"
      );

      const hex = data.tx.replace(/^0x/, "");
      const txBytes = new Uint8Array(
        hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
      );
      const deserializer = new Deserializer(txBytes);
      const transaction = SimpleTransaction.deserialize(deserializer);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { authenticator } = await adapter.signTransaction({
        transactionOrPayload: transaction as any,
      });

      const sigHex = extractEd25519SignatureHex(authenticator);

      // Generate new URL with signature added
      const newUrl = addSignatureToUrl(data, signerIndex, sigHex);
      const fullUrl = `${window.location.origin}${newUrl}`;
      setUpdatedUrl(fullUrl);

      // Update local state so the UI reflects the new signature
      const updatedData: UrlProposalData = {
        ...data,
        sigs: [...data.sigs, [signerIndex, sigHex]],
      };
      setData(updatedData);

      // Update browser URL without reload
      window.history.replaceState(null, "", newUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signing failed");
    } finally {
      setSigning(false);
    }
  }, [data, signerIndex, adapter]);

  const handleSubmit = useCallback(async () => {
    if (!data) return;
    setSubmitting(true);
    setSubmitResult(null);

    try {
      const {
        SimpleTransaction,
        Deserializer,
        Ed25519Signature,
        MultiEd25519Signature,
        MultiEd25519PublicKey,
        Ed25519PublicKey,
        AccountAuthenticatorMultiEd25519,
        Aptos,
        AptosConfig,
        Network,
      } = await import("@aptos-labs/ts-sdk");

      // Reconstruct the MultiEd25519PublicKey
      const pubKeys = data.pks.map((pk) => new Ed25519PublicKey(pk));
      const multiPubKey = new MultiEd25519PublicKey({
        publicKeys: pubKeys,
        threshold: data.th,
      });

      // Reconstruct signatures
      const sorted = [...data.sigs].sort((a, b) => a[0] - b[0]);
      const ed25519Sigs = sorted.map(([, sig]) => new Ed25519Signature(sig));
      const bitmap = MultiEd25519Signature.createBitmap({
        bits: sorted.map(([idx]) => idx),
      });
      const multiSig = new MultiEd25519Signature({
        signatures: ed25519Sigs,
        bitmap,
      });

      // Deserialize the transaction
      const hex = data.tx.replace(/^0x/, "");
      const txBytes = new Uint8Array(
        hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
      );
      const deserializer = new Deserializer(txBytes);
      const transaction = SimpleTransaction.deserialize(deserializer);

      // Build authenticator and submit
      const authenticator = new AccountAuthenticatorMultiEd25519(
        multiPubKey,
        multiSig,
      );

      // Network is imported as a value (enum-like), so we can't type the map
      // as `Record<AptosNetwork, Network>` directly. Inferred shape is fine.
      const networkMap = {
        mainnet: Network.MAINNET,
        testnet: Network.TESTNET,
        devnet: Network.DEVNET,
      } as const satisfies Record<
        AptosNetwork,
        (typeof Network)[keyof typeof Network]
      >;
      const config = new AptosConfig({
        network: networkMap[data.net as AptosNetwork] ?? Network.DEVNET,
      });
      const aptos = new Aptos(config);

      const response = await aptos.transaction.submit.simple({
        transaction,
        senderAuthenticator: authenticator,
      });

      setSubmitResult({ txHash: response.hash });
    } catch (err) {
      setSubmitResult({
        error: err instanceof Error ? err.message : "Submission failed",
      });
    } finally {
      setSubmitting(false);
    }
  }, [data]);

  const copyUrl = useCallback(() => {
    const url = updatedUrl ?? window.location.href;
    navigator.clipboard.writeText(url).catch(console.info);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  }, [updatedUrl]);

  if (error && !data) {
    return (
      <div className="mx-auto max-w-md py-16 text-center space-y-4">
        <h2 className="text-2xl font-bold">Invalid Proposal Link</h2>
        <p className="text-muted-foreground">{error}</p>
        <a
          href="/"
          className="text-sm underline text-muted-foreground hover:text-foreground"
        >
          Back to home
        </a>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-muted-foreground">Loading proposal...</p>
      </div>
    );
  }

  const signedCount = data.sigs.length;

  // Build signer responses for the status grid
  const responses = data.sigs.map(([idx, _sig]) => ({
    signerIndex: idx,
    publicKey: data.pks[idx] ?? "",
    response: "signed" as const,
    declineReason: null,
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Proposal</CardTitle>
            <div className="flex gap-2">
              <Badge variant="outline">URL mode</Badge>
              <Badge variant="outline">{data.net}</Badge>
              {isExpired ? (
                <Badge variant="destructive">Expired</Badge>
              ) : thresholdMet ? (
                submitResult?.txHash ? (
                  <Badge className="bg-green-600 text-white">Submitted</Badge>
                ) : (
                  <Badge className="bg-green-600 text-white">Ready</Badge>
                )
              ) : (
                <Badge variant="secondary">
                  {signedCount}/{data.th} signed
                </Badge>
              )}
            </div>
          </div>
          <CardDescription>{data.desc}</CardDescription>
        </CardHeader>
      </Card>

      {/* Transaction details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transaction Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {multisigAddress && (
            <div>
              <span className="font-medium">Multisig: </span>
              <a
                href={`https://explorer.aptoslabs.com/account/${multisigAddress}?network=${data.net}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-blue-600 hover:underline break-all"
              >
                {multisigAddress}
              </a>
            </div>
          )}
          <div>
            <span className="font-medium">Function: </span>
            <code className="text-xs">{data.fn}</code>
          </div>
          {data.args && data.args.length > 0 && (
            <div>
              <span className="font-medium">Arguments: </span>
              <code className="text-xs">{data.args.join(", ")}</code>
            </div>
          )}
          <div className="grid grid-cols-3 gap-4 text-xs">
            <div>
              <span className="text-muted-foreground">Seq #: </span>
              {data.seq}
            </div>
            <div>
              <span className="text-muted-foreground">Max Gas: </span>
              {data.gas}
            </div>
            <div>
              <span className="text-muted-foreground">Expires: </span>
              {new Date(data.exp * 1000).toLocaleString()}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Signers */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Signers</CardTitle>
        </CardHeader>
        <CardContent>
          <SignerStatusGrid
            publicKeys={data.pks}
            responses={responses}
            threshold={data.th}
          />
        </CardContent>
      </Card>

      {/* Offline signing / signature verification */}
      <OfflineSigningPanel
        rawTransactionBytes={data.tx}
        publicKeys={data.pks}
        responses={data.sigs.map(([idx, sig]) => ({
          signerIndex: idx,
          publicKey: data.pks[idx] ?? "",
          signature: sig,
          response: "signed",
        }))}
      />

      {/* Errors */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Network mismatch */}
      {connected && isSigner && !networkMatches && !isExpired && (
        <Card className="border-yellow-500">
          <CardContent className="pt-6">
            <p className="text-sm text-yellow-600">
              Switch your wallet to <strong>{data.net}</strong> to sign.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Sign action */}
      {canSign && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <Button onClick={handleSign} disabled={signing}>
              {signing ? "Signing..." : "Sign Transaction"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Updated URL after signing */}
      {updatedUrl && (
        <Card className="border-green-500">
          <CardHeader>
            <CardTitle className="text-base">Signed!</CardTitle>
            <CardDescription>
              Share this updated link with other signers. It contains your
              signature.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={updatedUrl}
                readOnly
                className="font-mono text-xs"
              />
              <Button variant="outline" onClick={copyUrl}>
                {copiedUrl ? "Copied!" : "Copy"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Submit */}
      {thresholdMet && !submitResult?.txHash && (
        <Card className="border-green-500">
          <CardHeader>
            <CardTitle className="text-base">Submit Transaction</CardTitle>
            <CardDescription>
              Threshold reached ({signedCount}/{data.th}). Ready to submit
              on-chain.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {submitResult?.error && (
              <p className="text-sm text-destructive">{submitResult.error}</p>
            )}
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Submitting..." : "Submit Transaction"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Tx result */}
      {submitResult?.txHash && (
        <Card className="border-green-500">
          <CardContent className="pt-6 space-y-2">
            <p className="text-sm font-medium">Transaction submitted!</p>
            <a
              href={`https://explorer.aptoslabs.com/txn/${submitResult.txHash}?network=${data.net}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-blue-600 hover:underline break-all"
            >
              {submitResult.txHash}
            </a>
          </CardContent>
        </Card>
      )}

      {/* Share current URL */}
      {!updatedUrl && !submitResult?.txHash && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <p className="text-xs text-muted-foreground">
              Share this URL with signers. All proposal data and signatures are
              encoded in the link — no server storage needed.
            </p>
            <Button variant="outline" size="sm" onClick={copyUrl}>
              {copiedUrl ? "Copied!" : "Copy Link"}
            </Button>
          </CardContent>
        </Card>
      )}

      {!connected && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Connect your wallet to sign this proposal.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="pt-2">
        <Button variant="outline" onClick={() => (window.location.href = "/")}>
          Back to Home
        </Button>
      </div>
    </div>
  );
}
