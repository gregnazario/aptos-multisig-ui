const DOMAIN = "APTOS_MULTISIG_UI::PROPOSE::";

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * Canonical string a proposal creator signs to prove authorship.
 *
 * This is the plain string the caller passes as the `message` to the wallet's
 * `signMessage`; the wallet wraps it in its own envelope (adding the nonce,
 * address, chain id, application) and the envelope is what actually gets
 * signed. Verification re-derives this string from `rawTransactionBytes` and
 * checks that the wallet's `fullMessage` contains it.
 *
 * Domain-separated so the signature can never be mistaken for a signer's
 * vote on the transaction itself.
 */
export async function buildProposalProofCanonicalString(
  rawTransactionBytes: Uint8Array,
): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed Uint8Array so the type aligns
  // cleanly with BufferSource across both Node and browser runtimes.
  const input = new Uint8Array(rawTransactionBytes.byteLength);
  input.set(rawTransactionBytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return DOMAIN + hex(digest);
}

export function hexToBytes(input: string): Uint8Array {
  const clean = input.replace(/^0x/, "");
  if (clean.length % 2 !== 0) {
    throw new Error("Odd-length hex string");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return `0x${hex(bytes)}`;
}
