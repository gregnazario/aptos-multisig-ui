import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

export type AptosNetwork = "mainnet" | "testnet" | "devnet";

const networkMap: Record<AptosNetwork, Network> = {
  mainnet: Network.MAINNET,
  testnet: Network.TESTNET,
  devnet: Network.DEVNET,
};

const clients: Partial<Record<AptosNetwork, Aptos>> = {};

export function getAptosClient(network: AptosNetwork): Aptos {
  if (!clients[network]) {
    const config = new AptosConfig({ network: networkMap[network] });
    clients[network] = new Aptos(config);
  }
  return clients[network]!;
}
