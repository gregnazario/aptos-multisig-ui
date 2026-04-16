import { type NextRequest, NextResponse } from "next/server";
import { type AptosNetwork, getAptosClient } from "@/lib/aptos/client";

/**
 * POST /api/multisig/simulate
 *
 * Simulates a transaction for a multisig account and returns
 * the expected changes (gas used, events, state changes).
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { multisigAddress, network, payload, maxGasAmount, gasUnitPrice } =
    body;

  if (!multisigAddress || !network || !payload) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    );
  }

  const aptos = getAptosClient(network as AptosNetwork);

  try {
    // Use the view/simulate API to simulate the transaction
    const result = await aptos.transaction.simulate.simple({
      signerPublicKey: undefined as any, // Simulation doesn't need a real signer
      transaction: await aptos.transaction.build.simple({
        sender: multisigAddress,
        data: {
          function: `${payload.module}::${payload.function}` as `${string}::${string}::${string}`,
          typeArguments: payload.typeArgs ?? [],
          functionArguments: payload.args ?? [],
        },
        options: {
          maxGasAmount: maxGasAmount ?? 10000,
          gasUnitPrice: gasUnitPrice ?? 100,
        },
      }),
    });

    // Extract useful information from simulation result
    const txResult = result[0];
    if (!txResult) {
      return NextResponse.json({ error: "Empty simulation result" }, { status: 500 });
    }

    return NextResponse.json({
      success: txResult.success,
      vmStatus: txResult.vm_status,
      gasUsed: txResult.gas_used,
      events: (txResult as any).events?.map((e: any) => ({
        type: e.type,
        data: e.data,
      })) ?? [],
      changes: (txResult as any).changes?.map((c: any) => ({
        type: c.type,
        address: c.address,
        resource: c.data?.type,
      })) ?? [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Simulation failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
