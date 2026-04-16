import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { type AptosNetwork, getAptosClient } from "@/lib/aptos/client";
import { db } from "@/lib/db";
import { multisigs, proposals } from "@/lib/db/schema";

/**
 * POST /api/proposal/{id}/check-status
 *
 * Checks the on-chain status of a submitted transaction and updates
 * the proposal record accordingly.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const proposal = await db.query.proposals.findFirst({
    where: eq(proposals.id, id),
  });

  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  if (proposal.status !== "submitted") {
    return NextResponse.json({ status: proposal.status });
  }

  if (!proposal.txHash) {
    return NextResponse.json({ status: "submitted", onChain: "unknown" });
  }

  const multisig = await db.query.multisigs.findFirst({
    where: eq(multisigs.id, proposal.multisigId),
  });

  if (!multisig) {
    return NextResponse.json({ status: "submitted", onChain: "unknown" });
  }

  const aptos = getAptosClient(multisig.network as AptosNetwork);

  try {
    const txn = await aptos.getTransactionByHash({
      transactionHash: proposal.txHash,
    });

    // The transaction response has a `success` field when it's been executed
    if ("success" in txn) {
      if (txn.success) {
        await db
          .update(proposals)
          .set({ status: "confirmed", updatedAt: new Date() })
          .where(eq(proposals.id, id));

        return NextResponse.json({ status: "confirmed", onChain: "success" });
      } else {
        const vmStatus =
          "vm_status" in txn ? String(txn.vm_status) : "Unknown error";

        await db
          .update(proposals)
          .set({
            status: "failed",
            failureReason: vmStatus,
            updatedAt: new Date(),
          })
          .where(eq(proposals.id, id));

        return NextResponse.json({
          status: "failed",
          onChain: "failed",
          reason: vmStatus,
        });
      }
    }

    // Transaction exists but hasn't been executed yet (still pending)
    return NextResponse.json({ status: "submitted", onChain: "pending" });
  } catch {
    // Transaction not found on-chain yet — still propagating
    return NextResponse.json({ status: "submitted", onChain: "not_found" });
  }
}
