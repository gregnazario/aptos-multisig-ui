import "server-only";
import { type AptosNetwork, getAptosClient } from "./client";

export interface AssetMetadata {
  /** Asset identifier exactly as supplied (preserves casing/formatting). */
  asset: string;
  /** Short ticker (e.g. `APT`, `USDC`). */
  symbol: string;
  /** Human-readable name. */
  name: string;
  /** Number of decimal places. */
  decimals: number;
  /** `coin` for legacy `Coin<T>`, `fa` for fungible-asset metadata objects. */
  kind: "coin" | "fa";
}

const APT_FA_ADDRESSES = new Set([
  "0xa",
  "0x000000000000000000000000000000000000000000000000000000000000000a",
]);

const APT_METADATA: AssetMetadata = {
  asset: "0x1::aptos_coin::AptosCoin",
  symbol: "APT",
  name: "Aptos Coin",
  decimals: 8,
  kind: "coin",
};

// Single in-process cache, keyed by `${network}:${asset.toLowerCase()}`.
// Negative results (asset not found / RPC error) are cached as `null` for a
// short period so a missing/invalid asset doesn't get re-fetched on every
// page load.
const cache = new Map<string, AssetMetadata | null>();
const NEG_TTL_MS = 60_000;
const negTimestamps = new Map<string, number>();

function cacheKey(network: AptosNetwork, asset: string): string {
  return `${network}:${asset.toLowerCase()}`;
}

function isCoinType(asset: string): boolean {
  return asset.includes("::");
}

function isAptosFa(asset: string): boolean {
  const lower = asset.toLowerCase();
  return APT_FA_ADDRESSES.has(lower);
}

async function fetchCoinMetadata(
  network: AptosNetwork,
  coinType: string,
): Promise<AssetMetadata | null> {
  // CoinInfo lives at the address that originally declared the type, which
  // is the first segment of the type tag (e.g. `0x1` for AptosCoin).
  const ownerAddress = coinType.split("::")[0];
  if (!ownerAddress) return null;
  const aptos = getAptosClient(network);
  try {
    const resource = await aptos.getAccountResource<{
      name: string;
      symbol: string;
      decimals: number;
    }>({
      accountAddress: ownerAddress,
      resourceType:
        `0x1::coin::CoinInfo<${coinType}>` as `${string}::${string}::${string}`,
    });
    return {
      asset: coinType,
      symbol: String(resource.symbol),
      name: String(resource.name),
      decimals: Number(resource.decimals),
      kind: "coin",
    };
  } catch {
    return null;
  }
}

async function fetchFaMetadata(
  network: AptosNetwork,
  metadataAddress: string,
): Promise<AssetMetadata | null> {
  const aptos = getAptosClient(network);
  try {
    const resource = await aptos.getAccountResource<{
      name: string;
      symbol: string;
      decimals: number;
    }>({
      accountAddress: metadataAddress,
      resourceType: "0x1::fungible_asset::Metadata",
    });
    return {
      asset: metadataAddress,
      symbol: String(resource.symbol),
      name: String(resource.name),
      decimals: Number(resource.decimals),
      kind: "fa",
    };
  } catch {
    return null;
  }
}

/**
 * Resolve symbol/name/decimals for a single asset. Returns null if the
 * resource can't be found (e.g. caller passed a bad address). Caches
 * results in-process for the lifetime of the server.
 *
 * Accepts either a Move type tag (`0x1::aptos_coin::AptosCoin`) or a
 * fungible-asset metadata object address (`0xa`, `0x...64hex`).
 */
export async function getAssetMetadata(
  network: AptosNetwork,
  asset: string,
): Promise<AssetMetadata | null> {
  const key = cacheKey(network, asset);
  if (cache.has(key)) {
    const ts = negTimestamps.get(key);
    if (ts && Date.now() - ts > NEG_TTL_MS) {
      cache.delete(key);
      negTimestamps.delete(key);
    } else {
      return cache.get(key) ?? null;
    }
  }

  // APT shortcut — works for both the coin form and the FA address.
  if (asset === APT_METADATA.asset || isAptosFa(asset)) {
    cache.set(key, APT_METADATA);
    return APT_METADATA;
  }

  const result = isCoinType(asset)
    ? await fetchCoinMetadata(network, asset)
    : await fetchFaMetadata(network, asset);

  cache.set(key, result);
  if (result === null) negTimestamps.set(key, Date.now());
  return result;
}

/**
 * Resolve metadata for many assets in parallel. Missing entries are
 * silently dropped from the returned map.
 */
export async function getAssetMetadataMap(
  network: AptosNetwork,
  assets: string[],
): Promise<Record<string, AssetMetadata>> {
  const unique = Array.from(new Set(assets));
  const entries = await Promise.all(
    unique.map(async (a) => [a, await getAssetMetadata(network, a)] as const),
  );
  const out: Record<string, AssetMetadata> = {};
  for (const [a, meta] of entries) {
    if (meta) out[a] = meta;
  }
  return out;
}
