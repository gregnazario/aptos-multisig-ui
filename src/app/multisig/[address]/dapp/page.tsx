import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { DappProxy } from "@/components/dapp-proxy";
import type { AptosNetwork } from "@/lib/aptos/client";
import { db } from "@/lib/db";
import { multisigs } from "@/lib/db/schema";

interface Props {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ network?: string }>;
}

export default async function DappProxyPage({ params, searchParams }: Props) {
  const { address } = await params;
  const { network: networkParam } = await searchParams;
  const network = (networkParam ?? "mainnet") as AptosNetwork;

  const multisig = await db.query.multisigs.findFirst({
    where: and(eq(multisigs.address, address), eq(multisigs.network, network)),
  });

  if (!multisig) {
    notFound();
  }

  const publicKeys: string[] = JSON.parse(multisig.publicKeys);

  return (
    <div className="-mx-4 -mt-4 flex min-h-[calc(100dvh-8rem)] flex-col sm:-mx-6 sm:-mt-6">
      <DappProxy
        multisigAddress={multisig.address}
        network={network}
        publicKeys={publicKeys}
        threshold={multisig.threshold}
      />
    </div>
  );
}
