import { type NextRequest, NextResponse } from "next/server";
import { type AptosNetwork, getAptosClient } from "@/lib/aptos/client";

/**
 * GET /api/multisig/abi?module=0x1::aptos_account&function=transfer&network=mainnet
 *
 * Fetches the ABI for a specific entry function from the chain.
 * Returns parameter types and generic type parameter count.
 */
export async function GET(request: NextRequest) {
  const moduleStr = request.nextUrl.searchParams.get("module");
  const functionName = request.nextUrl.searchParams.get("function");
  const network = (request.nextUrl.searchParams.get("network") ??
    "mainnet") as AptosNetwork;

  if (!moduleStr || !functionName) {
    return NextResponse.json(
      { error: "Missing module or function parameter" },
      { status: 400 },
    );
  }

  // Parse module into address and name
  const parts = moduleStr.split("::");
  if (parts.length !== 2) {
    return NextResponse.json(
      { error: "Module must be in format 'address::module_name'" },
      { status: 400 },
    );
  }

  const [moduleAddress, moduleName] = parts;
  const aptos = getAptosClient(network);

  try {
    // Fetch the module ABI
    const moduleData = await aptos.getAccountModule({
      accountAddress: moduleAddress,
      moduleName,
    });

    if (!moduleData?.abi) {
      return NextResponse.json(
        { error: "Module not found or has no ABI" },
        { status: 404 },
      );
    }

    // Find the specific function
    const allFunctions = [
      ...(moduleData.abi.exposed_functions ?? []),
    ];

    const fn = allFunctions.find((f: any) => f.name === functionName);

    if (!fn) {
      return NextResponse.json(
        {
          error: `Function '${functionName}' not found in ${moduleStr}`,
          availableFunctions: allFunctions
            .filter((f: any) => f.is_entry)
            .map((f: any) => f.name),
        },
        { status: 404 },
      );
    }

    // Filter out &signer params (the multisig account is the signer)
    const params = (fn.params ?? []).filter(
      (p: string) => p !== "&signer" && p !== "signer",
    );

    return NextResponse.json({
      module: moduleStr,
      function: functionName,
      isEntry: fn.is_entry ?? false,
      visibility: fn.visibility,
      genericTypeParams: fn.generic_type_params?.length ?? 0,
      params,
      returnTypes: fn.return ?? [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch ABI: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
