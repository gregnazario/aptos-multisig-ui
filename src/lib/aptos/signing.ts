import type { AccountAuthenticator } from "@aptos-labs/ts-sdk";

/**
 * Find the position of a signer's Ed25519 public key in a multisig's key list.
 *
 * Normalizes case and strips the optional `0x` prefix so callers don't have to
 * hand-align formats. Returns `-1` when not found (standard `findIndex` shape).
 *
 * Kept here (rather than in `multisig.ts`) so it can be imported from client
 * components without dragging `@aptos-labs/ts-sdk` into the browser bundle —
 * this function does pure string ops and has no runtime SDK dependency.
 */
export function findSignerIndex(
  publicKeyHexes: string[],
  signerPublicKeyHex: string,
): number {
  const normalized = signerPublicKeyHex.toLowerCase().replace(/^0x/, "");
  return publicKeyHexes.findIndex(
    (pk) => pk.toLowerCase().replace(/^0x/, "") === normalized,
  );
}

/**
 * Extract the raw 64-byte Ed25519 signature bytes from a signed account
 * authenticator returned by the wallet adapter.
 *
 * The adapter can return several authenticator variants depending on the
 * wallet; for our Ed25519-only multisig flow we only accept:
 *   - AccountAuthenticatorEd25519:   `.signature` is an `Ed25519Signature`
 *   - AccountAuthenticatorSingleKey: `.signature` is an `AnySignature` whose
 *     inner `.signature` is an `Ed25519Signature` (the Ed25519 variant of
 *     the single-key scheme).
 *
 * Any other variant (multi-key, secp256k1, etc.) throws — the multisig
 * design assumes plain Ed25519 sub-signers.
 *
 * Accepts an untyped `authenticator` because the wallet adapter's exported
 * union spans multiple authenticator types we only narrow at runtime.
 */
export function extractEd25519SignatureBytes(
  authenticator: AccountAuthenticator,
): Uint8Array {
  // The adapter may be built against a different copy of @aptos-labs/ts-sdk
  // than this app, so `instanceof` checks against our imported classes can
  // return false for what are functionally the same types. Duck-type instead:
  // look for a `signature` field that exposes `toUint8Array()`.
  const auth = authenticator as unknown as {
    signature?: {
      toUint8Array?: () => Uint8Array;
      signature?: { toUint8Array?: () => Uint8Array };
    };
  };

  // Case 1: AccountAuthenticatorEd25519 — signature is Ed25519Signature directly.
  const directBytes = auth.signature?.toUint8Array?.();
  if (directBytes && directBytes.length === 64) return directBytes;

  // Case 2: AccountAuthenticatorSingleKey — signature is AnySignature wrapping
  // an Ed25519Signature. `toUint8Array()` on AnySignature returns the inner
  // signature's bytes (not the BCS), which for Ed25519 is the raw 64 bytes.
  const innerBytes = auth.signature?.signature?.toUint8Array?.();
  if (innerBytes && innerBytes.length === 64) return innerBytes;

  throw new Error(
    "Signer returned an unsupported authenticator — multisig signers must use a plain Ed25519 wallet.",
  );
}

/** Convert raw bytes to a `0x`-prefixed lowercase hex string. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = "0x";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function extractEd25519SignatureHex(
  authenticator: AccountAuthenticator,
): string {
  return bytesToHex(extractEd25519SignatureBytes(authenticator));
}
