import "server-only";
import { AuthenticationKey, Ed25519PublicKey } from "@aptos-labs/ts-sdk";

let cached: Set<string> | null = null;
let warned = false;

function normalizeAddress(addr: string): string {
  return addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function loadAdminAddresses(): Set<string> {
  if (cached) return cached;
  const raw = process.env.APTOS_ADMIN_ADDRESSES ?? "";
  const entries = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  cached = new Set(entries.map(normalizeAddress));
  if (cached.size === 0 && !warned && process.env.NODE_ENV !== "production") {
    console.warn(
      "APTOS_ADMIN_ADDRESSES is empty; only multisig signers can create proposals.",
    );
    warned = true;
  }
  return cached;
}

/**
 * Derive the Aptos account address from an Ed25519 public key using the
 * standard single-signer authentication-key scheme. The returned address is
 * normalized lowercase hex without a leading 0x and padded to 64 chars.
 */
export function deriveAddressFromPublicKey(publicKeyHex: string): string {
  const pubKey = new Ed25519PublicKey(publicKeyHex);
  const authKey = AuthenticationKey.fromPublicKey({ publicKey: pubKey });
  return normalizeAddress(authKey.derivedAddress().toString());
}

/** True when the address derived from `publicKeyHex` is in APTOS_ADMIN_ADDRESSES. */
export function isAdmin(publicKeyHex: string): boolean {
  const set = loadAdminAddresses();
  if (set.size === 0) return false;
  try {
    return set.has(deriveAddressFromPublicKey(publicKeyHex));
  } catch {
    return false;
  }
}

/** Exported for tests to reset the module-level cache. */
export function __resetAdminCacheForTests(): void {
  cached = null;
  warned = false;
}
