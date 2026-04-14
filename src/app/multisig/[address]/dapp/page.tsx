import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { multisigs } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { DappProxy } from "@/components/dapp-proxy";
import type { AptosNetwork } from "@/lib/aptos/client";

interface Props {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ network?: string }>;
}

export default async function DappProxyPage({ params, searchParams }: Props) {
  const { address } = await params;
  const { network: networkParam } = await searchParams;
  const network = (networkParam ?? "mainnet") as AptosNetwork;

  const multisig = await db.query.multisigs.findFirst({
    where: and(
      eq(multisigs.address, address),
      eq(multisigs.network, network)
    ),
  });

  if (!multisig) {
    notFound();
  }

  const publicKeys: string[] = JSON.parse(multisig.publicKeys);

  return (
    <div className="max-w-4xl mx-auto w-full px-4 py-8">
      <DappProxy
        multisigAddress={multisig.address}
        network={network}
        publicKeys={publicKeys}
        threshold={multisig.threshold}
      />
    </div>
  );
}
