import { NextRequest, NextResponse } from "next/server";
import { getAptosClient, type AptosNetwork } from "@/lib/aptos/client";

const VALID_NETWORKS = ["mainnet", "testnet", "devnet"] as const;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");
  const network = searchParams.get("network");

  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  if (!network || !VALID_NETWORKS.includes(network as (typeof VALID_NETWORKS)[number])) {
    return NextResponse.json(
      { error: "network must be one of: mainnet, testnet, devnet" },
      { status: 400 }
    );
  }

  try {
    const client = getAptosClient(network as AptosNetwork);
    const accountInfo = await client.getAccountInfo({ accountAddress: address });
    const authKey = accountInfo.authentication_key;

    // The expected auth key for a fresh account is derived from the address itself.
    // If the on-chain auth key differs from the address (with 0x prefix), it may
    // indicate the account has been rotated or is not a standard multisig.
    const normalizedAddress = address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    const normalizedAuthKey = authKey?.toLowerCase().replace(/^0x/, "").padStart(64, "0");

    if (normalizedAuthKey && normalizedAuthKey !== normalizedAddress) {
      return NextResponse.json({
        warning:
          "On-chain authentication key differs from the derived address. The account key may have been rotated.",
        authKey,
      });
    }

    return NextResponse.json({ verified: true });
  } catch {
    // Account may not exist on-chain yet, which is fine for import
    return NextResponse.json({ verified: false, note: "Account not found on-chain. It may not have been funded yet." });
  }
}
