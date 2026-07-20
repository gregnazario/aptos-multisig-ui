import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { type AptosNetwork, getAptosClient } from "@/lib/aptos/client";
import { verifyAdmin } from "@/lib/auth/verify-admin";
import { db } from "@/lib/db";
import { multisigs, proposals } from "@/lib/db/schema";

const VALID_NETWORKS = ["mainnet", "testnet", "devnet"] as const;

type ProposalStatus = "pending" | "ready" | "submitted" | "expired" | "failed";

function emptyCounts(): Record<ProposalStatus, number> {
  return { pending: 0, ready: 0, submitted: 0, expired: 0, failed: 0 };
}

/**
 * GET /api/admin/multisigs?network=<net>
 *
 * Admin-only. Returns every multisig registered on the given network, each
 * enriched with proposal-status counts (from the DB) and best-effort on-chain
 * APT balance + sequence number. On-chain lookups that fail (e.g. the account
 * has never been created on chain) degrade that entry to `onChain:"unavailable"`
 * without failing the whole response.
 */
export async function GET(request: NextRequest) {
  const auth = await verifyAdmin(request.headers.get("authorization"));
  if (!auth.ok) return auth.response;

  const network = request.nextUrl.searchParams.get("network") ?? "mainnet";
  if (!VALID_NETWORKS.includes(network as (typeof VALID_NETWORKS)[number])) {
    return NextResponse.json(
      { error: "network must be one of: mainnet, testnet, devnet" },
      { status: 400 },
    );
  }

  const rows = await db.query.multisigs.findMany({
    where: eq(multisigs.network, network),
  });

  const aptos = getAptosClient(network as AptosNetwork);

  const enriched = await Promise.all(
    rows.map(async (ms) => {
      const publicKeys: string[] = JSON.parse(ms.publicKeys);

      // Proposal status counts from the DB.
      const props = await db.query.proposals.findMany({
        where: eq(proposals.multisigId, ms.id),
      });
      const proposalCounts = emptyCounts();
      for (const p of props) {
        const status = p.status as ProposalStatus;
        if (status in proposalCounts) proposalCounts[status] += 1;
      }

      // On-chain info, best-effort per multisig.
      let balanceApt: number | null = null;
      let sequenceNumber: number | null = null;
      let onChain: "ok" | "unavailable" = "ok";
      try {
        const [octas, info] = await Promise.all([
          aptos.getAccountAPTAmount({ accountAddress: ms.address }),
          aptos.getAccountInfo({ accountAddress: ms.address }),
        ]);
        balanceApt = Number(octas) / 1e8;
        sequenceNumber = Number(info.sequence_number);
      } catch {
        onChain = "unavailable";
      }

      return {
        id: ms.id,
        address: ms.address,
        label: ms.label,
        threshold: ms.threshold,
        signerCount: publicKeys.length,
        network: ms.network,
        createdAt: ms.createdAt,
        proposalCounts,
        balanceApt,
        sequenceNumber,
        onChain,
      };
    }),
  );

  // Newest first.
  enriched.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return NextResponse.json({ network, multisigs: enriched });
}
