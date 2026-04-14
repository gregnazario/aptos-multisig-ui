export interface PetraWallet {
  connect(): Promise<{ address: string; publicKey: string }>;
  disconnect(): Promise<void>;
  account(): Promise<{ address: string; publicKey: string }>;
  network(): Promise<{ name: string; chainId: string }>;
  signMessage(payload: SignMessagePayload): Promise<SignMessageResponse>;
  signTransaction(payload: unknown): Promise<{ signature: string }>;
  signAndSubmitTransaction(payload: unknown): Promise<{ hash: string }>;
  onAccountChange(
    callback: (account: { address: string; publicKey: string }) => void
  ): void;
  onNetworkChange(
    callback: (network: { name: string; chainId: string }) => void
  ): void;
}

export interface SignMessagePayload {
  message: string;
  nonce: string;
  address?: boolean;
  application?: boolean;
  chainId?: boolean;
}

export interface SignMessageResponse {
  signature: string;
  fullMessage: string;
  message: string;
  nonce: string;
  prefix: string;
  address?: string;
  application?: string;
  chainId?: number;
}

declare global {
  interface Window {
    aptos?: PetraWallet;
  }
}
