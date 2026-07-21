import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ProposalBuilder } from "@/components/proposal-builder";
import type { AptosNetwork } from "@/lib/aptos/client";
import { db } from "@/lib/db";
import { multisigs } from "@/lib/db/schema";

interface Props {
  params: Promise<{ address: string }>;
  searchParams: Promise<{
    network?: string;
    module?: string;
    name?: string;
    function?: string;
    type_args?: string;
    args?: string;
    desc?: string;
  }>;
}

function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export default async function ProposePage({ params, searchParams }: Props) {
  const { address } = await params;
  const {
    network: networkParam,
    module: moduleParam,
    name: nameParam,
    function: functionParam,
    type_args: typeArgsParam,
    args: argsParam,
    desc: descParam,
  } = await searchParams;
  const network = (networkParam ?? "mainnet") as AptosNetwork;

  const multisig = await db.query.multisigs.findFirst({
    where: and(eq(multisigs.address, address), eq(multisigs.network, network)),
  });

  if (!multisig) {
    notFound();
  }

  const publicKeys: string[] = JSON.parse(multisig.publicKeys);

  // args may intentionally include empty slots (e.g. FA metadata prefilled,
  // recipient/amount blank). Preserve empty entries between commas.
  const initialArgs = argsParam
    ? argsParam.split(",").map((s) => s.trim())
    : undefined;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 py-2 sm:py-4">
      <ProposalBuilder
        multisigAddress={multisig.address}
        network={network}
        threshold={multisig.threshold}
        publicKeys={publicKeys}
        initialModuleAddress={moduleParam}
        initialModuleName={nameParam}
        initialFunctionName={functionParam}
        initialTypeArgs={
          typeArgsParam !== undefined ? splitCsv(typeArgsParam) : undefined
        }
        initialArgs={initialArgs}
        initialDescription={descParam}
      />
    </div>
  );
}
