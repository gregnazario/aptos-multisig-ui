import { type NextRequest, NextResponse } from "next/server";
import type { AptosNetwork } from "@/lib/aptos/client";
import { buildTransaction } from "@/lib/aptos/transaction";

/**
 * POST /api/multisig/build-tx
 *
 * Builds and BCS-serializes a transaction without storing it.
 * Used for URL-based stateless proposals.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    multisigAddress,
    network,
    payload,
    maxGasAmount,
    gasUnitPrice,
    expirationSeconds,
    feePayerAddress,
    sequenceNumber,
  } = body;

  if (!multisigAddress || !network || !payload) {
    return NextResponse.json(
      { error: "Missing required fields: multisigAddress, network, payload" },
      { status: 400 },
    );
  }

  try {
    const built = await buildTransaction({
      multisigAddress,
      payload,
      maxGasAmount: maxGasAmount ?? 10000,
      gasUnitPrice: gasUnitPrice ?? 100,
      expirationSeconds: expirationSeconds ?? 86400,
      feePayerAddress: feePayerAddress ?? undefined,
      network: network as AptosNetwork,
      accountSequenceNumber:
        sequenceNumber !== undefined && sequenceNumber !== null
          ? Number(sequenceNumber)
          : undefined,
    });

    return NextResponse.json({
      rawTransactionBytes: built.rawTransactionBytes,
      sequenceNumber: built.sequenceNumber,
      maxGasAmount: built.maxGasAmount,
      gasUnitPrice: built.gasUnitPrice,
      expirationTimestampSecs: built.expirationTimestampSecs,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to build transaction: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
