import { type NextRequest, NextResponse } from "next/server";
import { type AptosNetwork, getAptosClient } from "@/lib/aptos/client";

const ADDRESS_REGEX = /^0x[0-9a-fA-F]{1,64}$/;
const VALID_NETWORKS: AptosNetwork[] = ["mainnet", "testnet", "devnet"];

/**
 * GET /api/account/public-key?address=0x...&network=mainnet
 *
 * Best-effort lookup of an Aptos account's Ed25519 public key by walking its
 * recent outgoing transactions and pulling the public key from the
 * authenticator. Returns 404 when no usable transaction is found so the
 * caller can fall back to asking the user for the public key directly.
 *
 * Only single-key Ed25519 (raw or single-sender) is supported. Keyless,
 * multi-key, secp256k1, and multi-ed25519 senders return 404.
 */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const network = (request.nextUrl.searchParams.get("network") ??
    "mainnet") as AptosNetwork;

  if (!address || !ADDRESS_REGEX.test(address)) {
    return NextResponse.json(
      { error: "Missing or invalid address parameter" },
      { status: 400 },
    );
  }
  if (!VALID_NETWORKS.includes(network)) {
    return NextResponse.json(
      { error: "Invalid network parameter" },
      { status: 400 },
    );
  }

  const aptos = getAptosClient(network);

  let transactions: unknown[];
  try {
    transactions = await aptos.getAccountTransactions({
      accountAddress: address,
      options: { limit: 25 },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `On-chain lookup failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  if (transactions.length === 0) {
    return NextResponse.json(
      {
        error:
          "No transactions found for this account. The account must have sent at least one transaction before its public key can be derived.",
      },
      { status: 404 },
    );
  }

  for (const txn of transactions) {
    const sig = (txn as { signature?: unknown }).signature;
    const pk = extractEd25519PublicKey(sig);
    if (pk) {
      return NextResponse.json({
        address,
        publicKey: pk,
        network,
        source: "on_chain",
        sourceTxn: (txn as { hash?: string }).hash,
      });
    }
  }

  return NextResponse.json(
    {
      error:
        "Could not derive a single-key Ed25519 public key from this account's recent transactions. The account may use a different authentication scheme (multisig, multi-key, keyless, secp256k1).",
    },
    { status: 404 },
  );
}

/**
 * Pull a 0x-prefixed 64-hex Ed25519 public key out of a tx signature object,
 * or return null if the authenticator isn't a single-key Ed25519.
 *
 * Handles raw `ed25519_signature`, `single_sender` wrappers, and fee-payer
 * / multi-agent envelopes whose `sender` is one of the above.
 */
function extractEd25519PublicKey(sig: unknown): string | null {
  if (!sig || typeof sig !== "object") return null;
  const s = sig as Record<string, unknown>;

  if (s.type === "ed25519_signature" && typeof s.public_key === "string") {
    return normalize(s.public_key);
  }

  if (s.type === "single_sender") {
    const pk = s.public_key as { type?: string; value?: string } | undefined;
    if (pk?.type === "ed25519" && typeof pk.value === "string") {
      return normalize(pk.value);
    }
    return null;
  }

  if (
    (s.type === "fee_payer_signature" || s.type === "multi_agent_signature") &&
    s.sender
  ) {
    return extractEd25519PublicKey(s.sender);
  }

  return null;
}

function normalize(hex: string): string | null {
  const cleaned = hex.startsWith("0x") ? hex : `0x${hex}`;
  return /^0x[0-9a-fA-F]{64}$/.test(cleaned) ? cleaned.toLowerCase() : null;
}
