import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, multisigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  getGasStationConfig,
  signAsFeePayer,
} from "@/lib/gas-station";
import type { AptosNetwork } from "@/lib/aptos/client";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { proposalId } = body;

  if (!proposalId || typeof proposalId !== "string") {
    return NextResponse.json(
      { error: "proposalId is required" },
      { status: 400 }
    );
  }

  const config = getGasStationConfig();
  if (!config.enabled) {
    return NextResponse.json(
      { error: "Gas station is not enabled" },
      { status: 503 }
    );
  }

  // Fetch proposal
  const proposal = await db.query.proposals.findFirst({
    where: eq(proposals.id, proposalId),
  });

  if (!proposal) {
    return NextResponse.json(
      { error: "Proposal not found" },
      { status: 404 }
    );
  }

  // Validate the proposal's fee_payer_address matches the gas station address
  if (!proposal.feePayerAddress) {
    return NextResponse.json(
      { error: "Proposal does not have a fee payer address" },
      { status: 400 }
    );
  }

  if (
    proposal.feePayerAddress.toLowerCase() !==
    config.address?.toLowerCase()
  ) {
    return NextResponse.json(
      { error: "Fee payer address does not match gas station" },
      { status: 400 }
    );
  }

  // Check network is supported
  const multisig = await db.query.multisigs.findFirst({
    where: eq(multisigs.id, proposal.multisigId),
  });

  if (!multisig) {
    return NextResponse.json(
      { error: "Associated multisig not found" },
      { status: 404 }
    );
  }

  const network = multisig.network as AptosNetwork;
  if (!config.networks.includes(network)) {
    return NextResponse.json(
      { error: `Gas station does not support network: ${network}` },
      { status: 400 }
    );
  }

  // Check gas cap
  if (proposal.maxGasAmount > config.maxGasPerTx) {
    return NextResponse.json(
      {
        error: `Max gas ${proposal.maxGasAmount} exceeds gas station cap of ${config.maxGasPerTx}`,
      },
      { status: 400 }
    );
  }

  // Sign as fee payer
  try {
    const feePayerSignature = signAsFeePayer(proposal.rawTransactionBytes);

    // Store the fee payer signature
    await db
      .update(proposals)
      .set({ feePayerSignature, updatedAt: new Date() })
      .where(eq(proposals.id, proposalId));

    return NextResponse.json({
      feePayerSignature,
      feePayerAddress: config.address,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to sign as fee payer";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
