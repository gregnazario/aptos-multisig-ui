import { NextRequest, NextResponse } from "next/server";
import { getAptosClient, type AptosNetwork } from "@/lib/aptos/client";

/**
 * GET /api/multisig/lookup?address=0x...&network=mainnet
 *
 * Looks up a MultiEd25519 account on-chain by finding a transaction it has
 * sent, then extracting the public keys and threshold from the authenticator.
 */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const network = (request.nextUrl.searchParams.get("network") ?? "mainnet") as AptosNetwork;

  if (!address) {
    return NextResponse.json({ error: "Missing address parameter" }, { status: 400 });
  }

  const aptos = getAptosClient(network);

  try {
    // Fetch recent transactions for this account
    const transactions = await aptos.getAccountTransactions({
      accountAddress: address,
      options: { limit: 25 },
    });

    if (transactions.length === 0) {
      return NextResponse.json(
        { error: "No transactions found for this account. The account must have sent at least one transaction to extract its public keys." },
        { status: 404 }
      );
    }

    // Look for a transaction with a multi_ed25519_signature authenticator
    for (const txn of transactions) {
      // The signature field varies by transaction type
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sig = (txn as any).signature;
      if (!sig) continue;

      // Direct multi_ed25519_signature
      if (sig.type === "multi_ed25519_signature") {
        return NextResponse.json({
          address,
          publicKeys: sig.public_keys,
          threshold: sig.threshold,
          network,
          source: "on_chain",
          sourceTxn: (txn as { hash?: string }).hash,
        });
      }

      // It might be wrapped in a fee_payer_signature or multi_agent_signature
      if (sig.type === "fee_payer_signature" && sig.sender) {
        const senderSig = sig.sender;
        if (senderSig.type === "multi_ed25519_signature") {
          return NextResponse.json({
            address,
            publicKeys: senderSig.public_keys,
            threshold: senderSig.threshold,
            network,
            source: "on_chain",
            sourceTxn: (txn as { hash?: string }).hash,
          });
        }
      }

      if (sig.type === "multi_agent_signature" && sig.sender) {
        const senderSig = sig.sender;
        if (senderSig.type === "multi_ed25519_signature") {
          return NextResponse.json({
            address,
            publicKeys: senderSig.public_keys,
            threshold: senderSig.threshold,
            network,
            source: "on_chain",
            sourceTxn: (txn as { hash?: string }).hash,
          });
        }
      }
    }

    return NextResponse.json(
      { error: "Could not find a MultiEd25519 signed transaction for this account. It may use a different authentication scheme." },
      { status: 404 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Lookup failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
