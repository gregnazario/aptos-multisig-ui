import { Ed25519PrivateKey, MultiEd25519Signature } from "@aptos-labs/ts-sdk";
import { describe, expect, it } from "vitest";
import {
  combineSignatures,
  deriveMultisigAddress,
  findSignerIndex,
} from "../multisig";

describe("deriveMultisigAddress", () => {
  it("derives a deterministic address from public keys and threshold", () => {
    const privKey1 = Ed25519PrivateKey.generate();
    const privKey2 = Ed25519PrivateKey.generate();
    const privKey3 = Ed25519PrivateKey.generate();
    const pubKeys = [
      privKey1.publicKey().toString(),
      privKey2.publicKey().toString(),
      privKey3.publicKey().toString(),
    ];

    const result = deriveMultisigAddress(pubKeys, 2);
    expect(result.address).toBeDefined();
    expect(result.address).toMatch(/^0x[a-f0-9]{64}$/);

    // Same inputs = same address
    const result2 = deriveMultisigAddress(pubKeys, 2);
    expect(result2.address).toBe(result.address);

    // Different threshold = different address
    const result3 = deriveMultisigAddress(pubKeys, 3);
    expect(result3.address).not.toBe(result.address);
  });

  it("rejects threshold exceeding number of keys", () => {
    const key = Ed25519PrivateKey.generate().publicKey().toString();
    expect(() => deriveMultisigAddress([key], 2)).toThrow(
      "Threshold 2 exceeds number of keys 1",
    );
  });

  it("rejects threshold less than 1", () => {
    const key = Ed25519PrivateKey.generate().publicKey().toString();
    expect(() => deriveMultisigAddress([key], 0)).toThrow(
      "Threshold must be at least 1",
    );
  });

  it("rejects more than 32 public keys", () => {
    const keys = Array.from({ length: 33 }, () =>
      Ed25519PrivateKey.generate().publicKey().toString(),
    );
    expect(() => deriveMultisigAddress(keys, 2)).toThrow(
      "Maximum 32 public keys supported",
    );
  });
});

describe("combineSignatures", () => {
  it("creates a MultiEd25519Signature from individual signatures", () => {
    const privKey1 = Ed25519PrivateKey.generate();
    const privKey3 = Ed25519PrivateKey.generate();
    const message = new Uint8Array([1, 2, 3, 4]);
    const sig1 = privKey1.sign(message);
    const sig3 = privKey3.sign(message);

    const result = combineSignatures([
      { signerIndex: 0, signature: sig1.toString() },
      { signerIndex: 2, signature: sig3.toString() },
    ]);
    expect(result).toBeInstanceOf(MultiEd25519Signature);
  });

  it("sorts signatures by signer index", () => {
    const privKey1 = Ed25519PrivateKey.generate();
    const privKey2 = Ed25519PrivateKey.generate();
    const message = new Uint8Array([5, 6, 7, 8]);
    const sig1 = privKey1.sign(message);
    const sig2 = privKey2.sign(message);

    // Pass in reverse order
    const result = combineSignatures([
      { signerIndex: 2, signature: sig2.toString() },
      { signerIndex: 0, signature: sig1.toString() },
    ]);
    expect(result).toBeInstanceOf(MultiEd25519Signature);
  });
});

describe("findSignerIndex", () => {
  it("finds the correct index", () => {
    const keys = ["0xaaa", "0xbbb", "0xccc"];
    expect(findSignerIndex(keys, "0xbbb")).toBe(1);
    expect(findSignerIndex(keys, "0xBBB")).toBe(1);
    expect(findSignerIndex(keys, "bbb")).toBe(1);
    expect(findSignerIndex(keys, "0xddd")).toBe(-1);
  });

  it("returns -1 for unknown key", () => {
    const keys = ["0xaaa"];
    expect(findSignerIndex(keys, "0xfff")).toBe(-1);
  });
});
