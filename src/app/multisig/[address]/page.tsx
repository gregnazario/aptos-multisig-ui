import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { multisigs } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ProposalList } from "@/components/proposal-list";
import type { AptosNetwork } from "@/lib/aptos/client";

interface Props {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ network?: string }>;
}

function truncateKey(key: string): string {
  if (key.length <= 18) return key;
  return `${key.slice(0, 10)}...${key.slice(-8)}`;
}

export default async function MultisigDashboardPage({
  params,
  searchParams,
}: Props) {
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
    <div className="max-w-3xl mx-auto w-full space-y-6 px-4 py-8">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">
            {multisig.label ?? "Multisig"}
          </h1>
          <Badge variant="outline">{network}</Badge>
        </div>
        <p className="text-sm text-muted-foreground font-mono break-all">
          {multisig.address}
        </p>
        <p className="text-sm text-muted-foreground">
          Threshold: {multisig.threshold}-of-{publicKeys.length}
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <Link
          href={`/multisig/${address}/propose?network=${network}`}
          className={cn(buttonVariants({ variant: "default" }))}
        >
          New Proposal
        </Link>
        <Link
          href={`/multisig/${address}/dapp?network=${network}`}
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Open dApp
        </Link>
      </div>

      {/* Signer list */}
      <Card>
        <CardHeader>
          <CardTitle>Signers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {publicKeys.map((key, index) => (
              <div
                key={key}
                className="flex items-center gap-2 text-sm"
              >
                <span className="text-muted-foreground w-6 text-right">
                  {index}
                </span>
                <code className="text-xs">{truncateKey(key)}</code>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Proposals */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Proposals</h2>
        <ProposalList
          address={address}
          network={network}
          threshold={multisig.threshold}
          publicKeys={publicKeys}
        />
      </div>
    </div>
  );
}
