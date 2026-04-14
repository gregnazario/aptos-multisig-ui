import { Ed25519PrivateKey, AccountAddress } from "@aptos-labs/ts-sdk";
import type { AptosNetwork } from "@/lib/aptos/client";

interface GasStationConfig {
  enabled: boolean;
  privateKey: Ed25519PrivateKey | null;
  address: string | null;
  publicKey: string | null;
  maxGasPerTx: number;
  networks: AptosNetwork[];
}

let config: GasStationConfig | null = null;

export function getGasStationConfig(): GasStationConfig {
  if (config) return config;
  const enabled = process.env.GAS_STATION_ENABLED === "true";
  const keyHex = process.env.GAS_STATION_PRIVATE_KEY;
  const maxGas = Number(process.env.GAS_STATION_MAX_GAS_PER_TX ?? "10000");
  const networks = (process.env.GAS_STATION_NETWORKS ?? "devnet,testnet")
    .split(",")
    .map((n) => n.trim()) as AptosNetwork[];

  let privateKey: Ed25519PrivateKey | null = null;
  let address: string | null = null;
  let publicKey: string | null = null;

  if (enabled && keyHex) {
    privateKey = new Ed25519PrivateKey(keyHex);
    const pubKey = privateKey.publicKey();
    publicKey = pubKey.toString();
    // Derive address from public key
    address = AccountAddress.from(pubKey.toUint8Array()).toString();
  }

  config = {
    enabled,
    privateKey,
    address,
    publicKey,
    maxGasPerTx: maxGas,
    networks,
  };
  return config;
}

export function signAsFeePayer(rawTransactionBytes: string): string {
  const cfg = getGasStationConfig();
  if (!cfg.enabled || !cfg.privateKey) {
    throw new Error("Gas station not configured");
  }
  const bytes = Uint8Array.from(Buffer.from(rawTransactionBytes, "hex"));
  const signature = cfg.privateKey.sign(bytes);
  return signature.toString();
}
