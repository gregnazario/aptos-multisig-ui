import { Ed25519PrivateKey } from "@aptos-labs/ts-sdk";
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetAdminCacheForTests,
  deriveAddressFromPublicKey,
} from "../admin";
import { createSessionToken } from "../session";
import { verifyAdmin } from "../verify-admin";

function makeKey() {
  const priv = Ed25519PrivateKey.generate();
  const publicKey = priv.publicKey().toString();
  const address = `0x${deriveAddressFromPublicKey(publicKey)}`;
  return { publicKey, address };
}

async function bearerFor(publicKey: string, address: string) {
  const token = await createSessionToken({
    publicKey,
    address,
    network: "testnet",
  });
  return `Bearer ${token}`;
}

describe("verifyAdmin", () => {
  const original = process.env.APTOS_ADMIN_ADDRESSES;

  afterEach(() => {
    process.env.APTOS_ADMIN_ADDRESSES = original;
    __resetAdminCacheForTests();
  });

  it("accepts a valid JWT whose signer is in the admin allowlist", async () => {
    const admin = makeKey();
    process.env.APTOS_ADMIN_ADDRESSES = admin.address;
    __resetAdminCacheForTests();

    const result = await verifyAdmin(
      await bearerFor(admin.publicKey, admin.address),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.publicKey).toBe(admin.publicKey);
  });

  it("rejects a valid JWT whose signer is not an admin with 403", async () => {
    const admin = makeKey();
    const other = makeKey();
    process.env.APTOS_ADMIN_ADDRESSES = admin.address;
    __resetAdminCacheForTests();

    const result = await verifyAdmin(
      await bearerFor(other.publicKey, other.address),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("rejects a missing or non-Bearer header with 401", async () => {
    const missing = await verifyAdmin(null);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.response.status).toBe(401);

    const nonBearer = await verifyAdmin("Token abc");
    expect(nonBearer.ok).toBe(false);
    if (!nonBearer.ok) expect(nonBearer.response.status).toBe(401);
  });

  it("rejects an invalid or malformed JWT with 401", async () => {
    const admin = makeKey();
    process.env.APTOS_ADMIN_ADDRESSES = admin.address;
    __resetAdminCacheForTests();

    const result = await verifyAdmin("Bearer not.a.real.jwt");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });
});
