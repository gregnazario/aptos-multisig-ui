"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWallet } from "@/components/wallet-provider";

const ADDRESS_REGEX = /^0x[0-9a-fA-F]{64}$/;
const PUBLIC_KEY_REGEX = /^0x[0-9a-fA-F]{64}$/;

type Step = "configure" | "signers";

type SignerStatus =
  | { kind: "idle" }
  | { kind: "resolving" }
  | { kind: "resolved"; publicKey: string; sourceTxn?: string }
  | { kind: "manual"; reason: string }
  | { kind: "error"; message: string };

interface SignerSlot {
  address: string;
  publicKey: string;
  status: SignerStatus;
}

const emptySlot = (): SignerSlot => ({
  address: "",
  publicKey: "",
  status: { kind: "idle" },
});

/**
 * Admin-only multisig creator. Lets an admin assemble a multisig from arbitrary
 * Aptos addresses without each signer having to verify themselves. For each
 * address we attempt to derive its Ed25519 public key from on-chain history
 * via `/api/account/public-key`. When that fails (e.g. the account hasn't
 * sent a transaction yet, or uses a non-supported scheme), the admin is
 * prompted to enter the public key manually.
 */
export function AdminMultisigCreator() {
  const { network } = useWallet();
  const router = useRouter();

  const [step, setStep] = useState<Step>("configure");
  const [numSigners, setNumSigners] = useState(3);
  const [threshold, setThreshold] = useState(2);
  const [label, setLabel] = useState("");
  const [signers, setSigners] = useState<SignerSlot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function goToSigners() {
    setError(null);
    if (threshold > numSigners) {
      setError("Threshold cannot exceed number of signers.");
      return;
    }
    setSigners(Array.from({ length: numSigners }, emptySlot));
    setStep("signers");
  }

  function updateSigner(index: number, patch: Partial<SignerSlot>) {
    setSigners((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  async function resolveSigner(index: number) {
    const slot = signers[index];
    const addr = slot.address.trim();
    if (!ADDRESS_REGEX.test(addr)) {
      updateSigner(index, {
        status: { kind: "error", message: "Invalid Aptos address." },
      });
      return;
    }

    updateSigner(index, { status: { kind: "resolving" }, publicKey: "" });

    try {
      const res = await fetch(
        `/api/account/public-key?address=${encodeURIComponent(addr)}&network=${network}`,
      );
      const data = await res.json();
      if (res.ok) {
        updateSigner(index, {
          publicKey: data.publicKey,
          status: {
            kind: "resolved",
            publicKey: data.publicKey,
            sourceTxn: data.sourceTxn,
          },
        });
      } else if (res.status === 404) {
        updateSigner(index, {
          status: {
            kind: "manual",
            reason:
              data.error ??
              "Public key not derivable from chain. Please enter it manually.",
          },
        });
      } else {
        updateSigner(index, {
          status: {
            kind: "error",
            message: data.error ?? `Lookup failed (${res.status})`,
          },
        });
      }
    } catch (err) {
      updateSigner(index, {
        status: {
          kind: "error",
          message: (err as Error).message,
        },
      });
    }
  }

  async function createMultisig() {
    setError(null);

    for (let i = 0; i < signers.length; i++) {
      const s = signers[i];
      if (!ADDRESS_REGEX.test(s.address.trim())) {
        setError(`Signer #${i + 1}: invalid address.`);
        return;
      }
      if (!PUBLIC_KEY_REGEX.test(s.publicKey.trim())) {
        setError(
          `Signer #${i + 1}: public key missing or invalid. Resolve from chain or enter manually.`,
        );
        return;
      }
    }

    const publicKeys = signers.map((s) => s.publicKey.trim().toLowerCase());
    const dupCheck = new Set(publicKeys);
    if (dupCheck.size !== publicKeys.length) {
      setError("Duplicate public keys are not allowed.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/multisig", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicKeys,
          threshold,
          network,
          label: label || undefined,
          skipVerification: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create multisig.");
        setSubmitting(false);
        return;
      }
      router.push(`/multisig/${data.address}?network=${network}`);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  if (step === "configure") {
    return (
      <div className="space-y-6">
        <Alert>
          <AlertDescription>
            Admin mode: create a multisig from arbitrary signer addresses
            without each signer verifying themselves. Public keys are looked up
            on chain when possible.
          </AlertDescription>
        </Alert>

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
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 31 }, (_, i) => i + 2).map((n) => (
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
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: numSigners }, (_, i) => i + 1).map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            {threshold}-of-{numSigners} multisig
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="admin-label">Label (optional)</Label>
          <Input
            id="admin-label"
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

        <Button onClick={goToSigners}>Next</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Alert>
        <AlertDescription>
          Enter each signer's Aptos address. Click <strong>Resolve</strong> to
          fetch its public key from chain. If chain lookup fails, paste the
          public key manually.
        </AlertDescription>
      </Alert>

      <div className="space-y-4">
        {signers.map((slot, i) => (
          <SignerRow
            key={i}
            index={i}
            slot={slot}
            onAddressChange={(v) =>
              updateSigner(i, {
                address: v,
                publicKey: "",
                status: { kind: "idle" },
              })
            }
            onPublicKeyChange={(v) => updateSigner(i, { publicKey: v })}
            onResolve={() => resolveSigner(i)}
          />
        ))}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
        <Button
          variant="outline"
          onClick={() => setStep("configure")}
          className="w-full sm:w-auto"
        >
          Back
        </Button>
        <Button
          onClick={createMultisig}
          disabled={submitting}
          className="w-full sm:w-auto"
        >
          {submitting ? "Creating..." : "Create Multisig"}
        </Button>
      </div>
    </div>
  );
}

function SignerRow({
  index,
  slot,
  onAddressChange,
  onPublicKeyChange,
  onResolve,
}: {
  index: number;
  slot: SignerSlot;
  onAddressChange: (v: string) => void;
  onPublicKeyChange: (v: string) => void;
  onResolve: () => void;
}) {
  const addrValid = ADDRESS_REGEX.test(slot.address.trim());
  const showManual =
    slot.status.kind === "manual" || slot.status.kind === "resolved";

  return (
    <div className="space-y-2 rounded-md border p-3">
      <Label>Signer #{index + 1}</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="0x... (64 hex chars)"
          value={slot.address}
          onChange={(e) => onAddressChange(e.target.value)}
          className={`min-w-0 flex-1 font-mono text-xs ${
            slot.address && !addrValid ? "border-red-500" : ""
          }`}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={onResolve}
          className="w-full shrink-0 sm:w-auto"
          disabled={!addrValid || slot.status.kind === "resolving"}
        >
          {slot.status.kind === "resolving" ? "Resolving..." : "Resolve"}
        </Button>
      </div>

      {slot.status.kind === "manual" && (
        <p className="text-xs text-amber-600">{slot.status.reason}</p>
      )}
      {slot.status.kind === "error" && (
        <p className="text-xs text-destructive">{slot.status.message}</p>
      )}
      {slot.status.kind === "resolved" && (
        <p className="text-xs text-emerald-600">
          Public key resolved from chain
          {slot.status.sourceTxn
            ? ` (tx ${slot.status.sourceTxn.slice(0, 10)}…)`
            : ""}
        </p>
      )}

      {showManual && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Public Key</Label>
          <Input
            placeholder="0x... (64 hex chars Ed25519 public key)"
            value={slot.publicKey}
            onChange={(e) => onPublicKeyChange(e.target.value)}
            className={`font-mono text-xs ${
              slot.publicKey && !PUBLIC_KEY_REGEX.test(slot.publicKey.trim())
                ? "border-red-500"
                : ""
            }`}
            readOnly={slot.status.kind === "resolved"}
          />
        </div>
      )}
    </div>
  );
}
