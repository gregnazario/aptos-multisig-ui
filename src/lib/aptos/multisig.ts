import {
  AuthenticationKey,
  Ed25519PublicKey,
  Ed25519Signature,
  MultiEd25519PublicKey,
  MultiEd25519Signature,
} from "@aptos-labs/ts-sdk";

export interface MultisigAddress {
  address: string;
  multiPublicKey: MultiEd25519PublicKey;
}

export function deriveMultisigAddress(
  publicKeyHexes: string[],
  threshold: number,
): MultisigAddress {
  if (threshold > publicKeyHexes.length) {
    throw new Error(
      `Threshold ${threshold} exceeds number of keys ${publicKeyHexes.length}`,
    );
  }
  if (threshold < 1) {
    throw new Error("Threshold must be at least 1");
  }
  if (publicKeyHexes.length > 32) {
    throw new Error("Maximum 32 public keys supported");
  }

  const publicKeys = publicKeyHexes.map((hex) => new Ed25519PublicKey(hex));
  const multiPublicKey = new MultiEd25519PublicKey({ publicKeys, threshold });
  const authKey = AuthenticationKey.fromPublicKey({
    publicKey: multiPublicKey,
  });
  const address = authKey.derivedAddress().toString();

  return { address, multiPublicKey };
}

export interface SignatureWithIndex {
  signerIndex: number;
  signature: string; // hex
}

export function combineSignatures(
  signatures: SignatureWithIndex[],
): MultiEd25519Signature {
  if (signatures.length === 0) {
    throw new Error("At least one signature is required");
  }
  const sorted = [...signatures].sort((a, b) => a.signerIndex - b.signerIndex);
  const ed25519Sigs = sorted.map((s) => new Ed25519Signature(s.signature));
  const bitmap = MultiEd25519Signature.createBitmap({
    bits: sorted.map((s) => s.signerIndex),
  });
  return new MultiEd25519Signature({ signatures: ed25519Sigs, bitmap });
}

export function findSignerIndex(
  publicKeyHexes: string[],
  signerPublicKeyHex: string,
): number {
  const normalized = signerPublicKeyHex.toLowerCase().replace(/^0x/, "");
  return publicKeyHexes.findIndex(
    (pk) => pk.toLowerCase().replace(/^0x/, "") === normalized,
  );
}
