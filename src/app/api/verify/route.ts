import { Ed25519PublicKey, Ed25519Signature } from "@aptos-labs/ts-sdk";
import { type NextRequest, NextResponse } from "next/server";
import { createSessionToken } from "@/lib/auth/session";

const usedNonces = new Set<string>();

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { publicKey, signature, fullMessage, nonce, address, network } = body;

  // Reject non-Ed25519 keys (keyless wallets are incompatible with MultiEd25519)
  const pkHex = (publicKey ?? "").replace(/^0x/, "");
  if (pkHex.length !== 64 || !/^[0-9a-fA-F]+$/.test(pkHex)) {
    return NextResponse.json(
      { error: "Only Ed25519 wallets are supported. Keyless wallets (Aptos Connect, Google login) are not compatible." },
      { status: 400 },
    );
  }

  if (usedNonces.has(nonce)) {
    return NextResponse.json({ error: "Nonce already used" }, { status: 400 });
  }

  if (!fullMessage.includes("Multisig Verification")) {
    return NextResponse.json(
      { error: "Invalid message format" },
      { status: 400 },
    );
  }

  try {
    const pubKey = new Ed25519PublicKey(publicKey);
    const sig = new Ed25519Signature(signature);
    const messageBytes = new TextEncoder().encode(fullMessage);
    const isValid = pubKey.verifySignature({
      message: messageBytes,
      signature: sig,
    });
    if (!isValid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } catch {
    return NextResponse.json(
      { error: "Signature verification failed" },
      { status: 401 },
    );
  }

  usedNonces.add(nonce);
  const token = await createSessionToken({ publicKey, address, network });
  return NextResponse.json({ token });
}
