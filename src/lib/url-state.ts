/**
 * URL-based stateless proposal encoding/decoding.
 *
 * All proposal data is encoded as base64url JSON in the URL hash fragment.
 * No database needed — signers pass URLs around to accumulate signatures.
 */

export interface UrlProposalData {
  // Multisig config
  pks: string[]; // ordered Ed25519 public keys (hex)
  th: number; // threshold
  net: string; // network

  // Transaction
  tx: string; // raw SimpleTransaction bytes (hex)
  desc: string; // human-readable description
  fn: string; // entry function for display (e.g. "0x1::aptos_account::transfer")
  args?: string[]; // function arguments for display
  seq: number; // sequence number
  exp: number; // expiration timestamp (unix seconds)
  gas: number; // max gas amount
  gasPrice: number; // gas unit price

  // Collected signatures
  sigs: [number, string][]; // [signerIndex, signatureHex][]
}

/**
 * Encode proposal data into a URL hash fragment.
 */
export function encodeProposalUrl(
  data: UrlProposalData,
  basePath: string = "/tx/sign",
): string {
  const json = JSON.stringify(data);
  const base64 = btoa(unescape(encodeURIComponent(json)));
  // Make URL-safe: replace + with -, / with _, remove trailing =
  const urlSafe = base64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${basePath}#${urlSafe}`;
}

/**
 * Decode proposal data from a URL hash fragment.
 */
export function decodeProposalUrl(hash: string): UrlProposalData | null {
  try {
    const base64 = hash.replace(/^#/, "").replace(/-/g, "+").replace(/_/g, "/");
    // Add back padding
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = decodeURIComponent(escape(atob(padded)));
    return JSON.parse(json) as UrlProposalData;
  } catch {
    return null;
  }
}

/**
 * Add a signature to the proposal data and return a new encoded URL.
 */
export function addSignatureToUrl(
  data: UrlProposalData,
  signerIndex: number,
  signature: string,
): string {
  const updated: UrlProposalData = {
    ...data,
    sigs: [...data.sigs, [signerIndex, signature]],
  };
  return encodeProposalUrl(updated);
}

/**
 * Check if the proposal has enough signatures to submit.
 */
export function hasThreshold(data: UrlProposalData): boolean {
  return data.sigs.length >= data.th;
}

/**
 * Check if a signer has already signed.
 */
export function hasSignerSigned(
  data: UrlProposalData,
  signerIndex: number,
): boolean {
  return data.sigs.some(([idx]) => idx === signerIndex);
}
