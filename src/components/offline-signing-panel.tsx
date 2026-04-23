"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface SignerResponseForSig {
  signerIndex: number;
  publicKey: string;
  signature: string | null;
  response: string;
}

export interface ExportedSignature {
  signerIndex: number;
  publicKey: string;
  signature: string;
}

interface SignatureCheck {
  signerIndex: number;
  publicKey: string;
  valid: boolean;
  error?: string;
}

interface OfflineSigningPanelProps {
  /** Hex-encoded serialized SimpleTransaction (what a signer signs). */
  rawTransactionBytes: string;
  /** Parent multisig's full key list, used to resolve signerIndex → publicKey when absent. */
  publicKeys: string[];
  /** Responses collected from signers (subset with response==="signed" is what we verify). */
  responses: SignerResponseForSig[];
}

function triggerDownload(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function OfflineSigningPanel({
  rawTransactionBytes,
  publicKeys,
  responses,
}: OfflineSigningPanelProps) {
  const initialSignaturesJson = useMemo(
    () =>
      JSON.stringify(
        responses
          .filter((r) => r.response === "signed" && r.signature)
          .map<ExportedSignature>((r) => ({
            signerIndex: r.signerIndex,
            publicKey: r.publicKey,
            signature: r.signature as string,
          })),
        null,
        2,
      ),
    [responses],
  );

  const [payloadHex, setPayloadHex] = useState(rawTransactionBytes);
  const [signaturesJson, setSignaturesJson] = useState(initialSignaturesJson);
  const [verifying, setVerifying] = useState(false);
  const [results, setResults] = useState<SignatureCheck[] | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<"payload" | "sigs" | null>(
    null,
  );

  // Keep the textareas in sync if the parent-provided values change
  // (e.g. a new signature arrives via polling and refetch).
  useEffect(() => {
    setPayloadHex(rawTransactionBytes);
  }, [rawTransactionBytes]);

  useEffect(() => {
    setSignaturesJson(initialSignaturesJson);
  }, [initialSignaturesJson]);

  const handleCopy = useCallback(
    async (text: string, field: "payload" | "sigs") => {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 1500);
      } catch {
        // ignore clipboard errors
      }
    },
    [],
  );

  const handleVerify = useCallback(async () => {
    setVerifying(true);
    setVerifyError(null);
    setResults(null);

    try {
      const {
        Ed25519PublicKey,
        Ed25519Signature,
        Deserializer,
        SimpleTransaction,
        generateSigningMessageForTransaction,
      } = await import("@aptos-labs/ts-sdk");

      // Decode the signing payload
      const hex = payloadHex.trim().replace(/^0x/, "");
      if (!hex) throw new Error("Signing payload is empty");
      if (!/^[0-9a-fA-F]+$/.test(hex)) {
        throw new Error("Signing payload must be hex");
      }
      const txBytes = new Uint8Array(
        hex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? [],
      );
      const transaction = SimpleTransaction.deserialize(
        new Deserializer(txBytes),
      );
      const signingMessage = generateSigningMessageForTransaction(transaction);

      // Parse signatures JSON
      let parsed: unknown;
      try {
        parsed = JSON.parse(signaturesJson || "[]");
      } catch (err) {
        throw new Error(`Invalid signatures JSON: ${(err as Error).message}`);
      }
      if (!Array.isArray(parsed)) {
        throw new Error("Signatures must be a JSON array");
      }

      const checks: SignatureCheck[] = parsed.map((entry, i) => {
        const item = entry as {
          signerIndex?: number;
          publicKey?: string;
          signature?: string;
        };
        const signerIndex = item.signerIndex ?? i;
        const resolvedPublicKey =
          item.publicKey ?? publicKeys[signerIndex] ?? "";
        try {
          if (!item.signature) {
            return {
              signerIndex,
              publicKey: resolvedPublicKey,
              valid: false,
              error: "Missing signature",
            };
          }
          if (!resolvedPublicKey) {
            return {
              signerIndex,
              publicKey: "",
              valid: false,
              error: `No public key for signer index ${signerIndex}`,
            };
          }
          const pk = new Ed25519PublicKey(resolvedPublicKey);
          const sig = new Ed25519Signature(item.signature);
          const valid = pk.verifySignature({
            message: signingMessage,
            signature: sig,
          });
          return { signerIndex, publicKey: resolvedPublicKey, valid };
        } catch (err) {
          return {
            signerIndex,
            publicKey: resolvedPublicKey,
            valid: false,
            error: (err as Error).message,
          };
        }
      });

      setResults(checks);
    } catch (err) {
      setVerifyError(
        err instanceof Error ? err.message : "Verification failed",
      );
    } finally {
      setVerifying(false);
    }
  }, [payloadHex, signaturesJson, publicKeys]);

  const allValid = results?.every((r) => r.valid) ?? false;
  const anyInvalid = results?.some((r) => !r.valid) ?? false;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Offline Signing</CardTitle>
          {results !== null && (
            <Badge
              className={
                allValid
                  ? "bg-green-600 text-white"
                  : anyInvalid
                    ? "bg-red-600 text-white"
                    : undefined
              }
              variant={allValid || anyInvalid ? undefined : "secondary"}
            >
              {allValid
                ? "All valid"
                : anyInvalid
                  ? "Invalid signatures"
                  : "No signatures"}
            </Badge>
          )}
        </div>
        <CardDescription>
          Export the signing payload for an offline signer, or paste signatures
          to verify them against the payload. Verification is entirely
          client-side.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Signing Payload */}
        <div className="space-y-2">
          <Label htmlFor="payload-hex">Signing Payload (hex)</Label>
          <Textarea
            id="payload-hex"
            value={payloadHex}
            onChange={(e) => setPayloadHex(e.target.value)}
            rows={3}
            className="font-mono text-xs"
            spellCheck={false}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => handleCopy(payloadHex, "payload")}
            >
              {copiedField === "payload" ? "Copied!" : "Copy"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => triggerDownload("signing-payload.hex", payloadHex)}
            >
              Download
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setPayloadHex(rawTransactionBytes)}
              disabled={payloadHex === rawTransactionBytes}
            >
              Reset
            </Button>
          </div>
        </div>

        {/* Signatures */}
        <div className="space-y-2">
          <Label htmlFor="signatures-json">Signatures (JSON)</Label>
          <Textarea
            id="signatures-json"
            value={signaturesJson}
            onChange={(e) => setSignaturesJson(e.target.value)}
            rows={8}
            className="font-mono text-xs"
            spellCheck={false}
            placeholder='[{ "signerIndex": 0, "publicKey": "0x...", "signature": "0x..." }]'
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => handleCopy(signaturesJson, "sigs")}
            >
              {copiedField === "sigs" ? "Copied!" : "Copy"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => triggerDownload("signatures.json", signaturesJson)}
            >
              Download
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setSignaturesJson(initialSignaturesJson)}
              disabled={signaturesJson === initialSignaturesJson}
            >
              Reset
            </Button>
          </div>
        </div>

        {/* Verify */}
        <div className="pt-2 border-t space-y-3">
          <Button
            type="button"
            onClick={handleVerify}
            disabled={verifying}
            className="w-full sm:w-auto"
          >
            {verifying ? "Verifying..." : "Verify Signatures"}
          </Button>

          {verifyError && (
            <p className="text-destructive text-xs">{verifyError}</p>
          )}

          {results && results.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No signatures provided.
            </p>
          )}

          {results && results.length > 0 && (
            <ul className="space-y-1 text-xs">
              {results.map((r, i) => (
                <li
                  key={`${r.signerIndex}-${i}`}
                  className="flex items-center gap-2 flex-wrap"
                >
                  <span className="font-mono w-10 shrink-0">
                    #{r.signerIndex}
                  </span>
                  {r.valid ? (
                    <Badge className="bg-green-600 text-white">Valid</Badge>
                  ) : (
                    <Badge variant="destructive">Invalid</Badge>
                  )}
                  {r.publicKey && (
                    <code className="text-[10px] text-muted-foreground break-all">
                      {r.publicKey.slice(0, 18)}…{r.publicKey.slice(-8)}
                    </code>
                  )}
                  {r.error && (
                    <span className="text-destructive">— {r.error}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
