import {
  AuthenticationKey,
  Ed25519PublicKey,
  Ed25519Signature,
} from "@aptos-labs/ts-sdk";
import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { deriveMultisigAddress } from "@/lib/aptos/multisig";
import { db } from "@/lib/db";
import { multisigSetups, multisigs, setupVerifications } from "@/lib/db/schema";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { address, publicKey, signature, fullMessage, nonce } = body as {
    address?: string;
    publicKey?: string;
    signature?: string;
    fullMessage?: string;
    nonce?: string;
  };

  if (!address || !publicKey || !signature || !fullMessage || !nonce) {
    return NextResponse.json(
      {
        error:
          "address, publicKey, signature, fullMessage, and nonce are all required",
      },
      { status: 400 },
    );
  }

  // 0. Validate the public key is a standard Ed25519 key (32 bytes = 0x + 64 hex).
  // Keyless wallets (Aptos Connect, Google login) produce longer keys that are
  // incompatible with MultiEd25519 multisig.
  const pkHex = publicKey.replace(/^0x/, "");
  if (pkHex.length !== 64 || !/^[0-9a-fA-F]+$/.test(pkHex)) {
    return NextResponse.json(
      {
        error:
          "Invalid public key: only standard Ed25519 keys (32 bytes) are supported. Keyless wallets (Aptos Connect, Google login) are not compatible with MultiEd25519 multisig.",
      },
      { status: 400 },
    );
  }

  // 1. Setup exists and is pending
  const setup = await db.query.multisigSetups.findFirst({
    where: eq(multisigSetups.id, id),
  });

  if (!setup) {
    return NextResponse.json({ error: "Setup not found" }, { status: 404 });
  }

  if (setup.status !== "pending") {
    return NextResponse.json(
      { error: "Setup is already complete" },
      { status: 400 },
    );
  }

  // 2. Address is in the setup's address list
  const addresses: string[] = JSON.parse(setup.addresses);
  const addressMatch = addresses.find(
    (a) => a.toLowerCase() === address.toLowerCase(),
  );
  if (!addressMatch) {
    return NextResponse.json(
      { error: "Address is not part of this multisig setup" },
      { status: 400 },
    );
  }

  // 3. Address hasn't already been verified
  const existingVerifications = await db.query.setupVerifications.findMany({
    where: eq(setupVerifications.setupId, id),
  });

  const alreadyVerified = existingVerifications.some(
    (v) => v.address.toLowerCase() === address.toLowerCase(),
  );
  if (alreadyVerified) {
    return NextResponse.json(
      { error: "Address has already been verified" },
      { status: 400 },
    );
  }

  // 4. Verify signature
  try {
    const pubKey = new Ed25519PublicKey(publicKey);
    const sig = new Ed25519Signature(signature);
    const messageBytes = new TextEncoder().encode(fullMessage);
    const isValid = pubKey.verifySignature({
      message: messageBytes,
      signature: sig,
    });
    if (!isValid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Signature verification failed: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  // 5. Verify publicKey matches address
  try {
    const pubKey = new Ed25519PublicKey(publicKey);
    const authKey = AuthenticationKey.fromPublicKey({ publicKey: pubKey });
    const derivedAddress = authKey.derivedAddress().toString();
    if (derivedAddress.toLowerCase() !== address.toLowerCase()) {
      return NextResponse.json(
        { error: "Public key does not match the claimed address" },
        { status: 400 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Address derivation failed: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  // Store the verification
  await db.insert(setupVerifications).values({
    id: uuid(),
    setupId: id,
    address: addressMatch, // use the original case from the setup
    publicKey,
    signature,
    fullMessage,
    nonce,
  });

  // Check if all addresses are now verified
  const allVerifications = await db.query.setupVerifications.findMany({
    where: eq(setupVerifications.setupId, id),
  });

  const allVerified = addresses.every((addr) =>
    allVerifications.some(
      (v) => v.address.toLowerCase() === addr.toLowerCase(),
    ),
  );

  if (allVerified) {
    // Collect public keys in address order
    const publicKeysInOrder = addresses.map((addr) => {
      const v = allVerifications.find(
        (ver) => ver.address.toLowerCase() === addr.toLowerCase(),
      );
      return v!.publicKey;
    });

    // Derive multisig address
    const { address: multisigAddress } = deriveMultisigAddress(
      publicKeysInOrder,
      setup.threshold,
    );

    // Create the multisig record
    const multisigId = uuid();
    await db.insert(multisigs).values({
      id: multisigId,
      address: multisigAddress,
      publicKeys: JSON.stringify(publicKeysInOrder),
      threshold: setup.threshold,
      network: setup.network,
      label: setup.label,
    });

    // Update setup status
    await db
      .update(multisigSetups)
      .set({ status: "complete", multisigId })
      .where(eq(multisigSetups.id, id));

    return NextResponse.json({
      verified: true,
      complete: true,
      multisigAddress,
    });
  }

  return NextResponse.json({ verified: true, complete: false });
}
