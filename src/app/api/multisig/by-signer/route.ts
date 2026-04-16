import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { multisigSetups, multisigs, setupVerifications } from "@/lib/db/schema";

/**
 * GET /api/multisig/by-signer?address=0x...&network=devnet
 *
 * Returns all multisigs and pending setups where the given address is a signer.
 */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const network = request.nextUrl.searchParams.get("network") ?? "mainnet";

  if (!address) {
    return NextResponse.json(
      { error: "Missing address parameter" },
      { status: 400 },
    );
  }

  const lowerAddress = address.toLowerCase();

  // 1. Find completed multisigs via setup verifications
  const verifications = await db.query.setupVerifications.findMany({
    where: eq(setupVerifications.address, address),
  });

  // Also check case-insensitive by fetching all and filtering
  const allVerifications =
    verifications.length > 0
      ? verifications
      : await db.query.setupVerifications
          .findMany()
          .then((all) =>
            all.filter((v) => v.address.toLowerCase() === lowerAddress),
          );

  const setupIds = [...new Set(allVerifications.map((v) => v.setupId))];

  // Get the completed setups with matching network
  const completedSetups = [];
  for (const setupId of setupIds) {
    const setup = await db.query.multisigSetups.findFirst({
      where: and(
        eq(multisigSetups.id, setupId),
        eq(multisigSetups.status, "complete"),
        eq(multisigSetups.network, network),
      ),
    });
    if (setup) completedSetups.push(setup);
  }

  // Get the actual multisig records
  const multisigRecords = [];
  for (const setup of completedSetups) {
    if (setup.multisigId) {
      const ms = await db.query.multisigs.findFirst({
        where: eq(multisigs.id, setup.multisigId),
      });
      if (ms) {
        multisigRecords.push({
          ...ms,
          publicKeys: JSON.parse(ms.publicKeys),
        });
      }
    }
  }

  // Also search multisigs table directly — for imported multisigs where
  // the address might be derivable from one of the stored public keys.
  // For now, we just return what we found via setups.

  // 2. Find pending setups where this address is listed
  const allSetups = await db.query.multisigSetups.findMany({
    where: and(
      eq(multisigSetups.status, "pending"),
      eq(multisigSetups.network, network),
    ),
  });

  const pendingSetups = allSetups.filter((s) => {
    const addresses: string[] = JSON.parse(s.addresses);
    return addresses.some((a) => a.toLowerCase() === lowerAddress);
  });

  // Enrich pending setups with verification count
  const enrichedPending = await Promise.all(
    pendingSetups.map(async (s) => {
      const vCount = await db.query.setupVerifications
        .findMany({ where: eq(setupVerifications.setupId, s.id) })
        .then((vs) => vs.length);
      const addresses: string[] = JSON.parse(s.addresses);
      return {
        id: s.id,
        addresses,
        threshold: s.threshold,
        network: s.network,
        label: s.label,
        createdBy: s.createdBy,
        verifiedCount: vCount,
        totalSigners: addresses.length,
      };
    }),
  );

  return NextResponse.json({
    multisigs: multisigRecords,
    pendingSetups: enrichedPending,
  });
}
