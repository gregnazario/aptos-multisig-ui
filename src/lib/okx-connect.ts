/**
 * OKX Connect integration for Aptos.
 *
 * Uses @okxconnect/universal-provider + @okxconnect/ui to pair with
 * the OKX mobile app via QR code scan. Returns Ed25519 keys compatible
 * with MultiEd25519 multisig.
 */

import type { OKXUniversalConnectUI } from "@okxconnect/ui";

let uiInstance: OKXUniversalConnectUI | null = null;

export async function getOKXConnectUI(): Promise<OKXUniversalConnectUI> {
  if (uiInstance?.connected()) return uiInstance;

  // Dynamic import to avoid SSR issues
  const { OKXUniversalConnectUI } = await import("@okxconnect/ui");

  uiInstance = await OKXUniversalConnectUI.init({
    dappMetaData: {
      name: "Aptos Multisig",
      icon:
        typeof window !== "undefined"
          ? `${window.location.origin}/favicon.ico`
          : "",
    },
    actionsConfiguration: {
      returnStrategy: "none",
    },
    language: "en_US" as any,
    uiPreferences: {
      theme: "SYSTEM" as any,
    },
  });

  return uiInstance;
}

export interface OKXAccount {
  address: string;
  publicKey: string;
}

export async function connectOKX(network: string): Promise<OKXAccount> {
  const ui = await getOKXConnectUI();

  const chainId =
    network === "mainnet" ? "1" : network === "testnet" ? "2" : "34";

  const session = await ui.openModal({
    namespaces: {
      aptos: {
        chains: [`aptos:${chainId}`],
      },
    },
  });

  if (!session?.namespaces?.aptos) {
    throw new Error("OKX Connect: no Aptos session returned");
  }

  // Extract account from session
  // Format is usually "aptos:chainId:address"
  const accounts = session.namespaces.aptos.accounts ?? [];
  if (accounts.length === 0) {
    throw new Error("OKX Connect: no accounts returned");
  }

  // Parse "aptos:chainId:address" format
  const parts = accounts[0].split(":");
  const address = parts[parts.length - 1];

  // Get public key - it may be in the session or we need to request it
  // OKX stores it in the account info
  const publicKey =
    (session.namespaces.aptos as any).defaultChain?.publicKey ??
    (session as any).publicKey ??
    "";

  return { address, publicKey };
}

export async function disconnectOKX(): Promise<void> {
  if (uiInstance) {
    await uiInstance.disconnect();
  }
}

export function isOKXConnected(): boolean {
  return uiInstance?.connected() ?? false;
}

export async function signMessageOKX(
  message: string,
  nonce: string,
): Promise<{
  signature: string;
  fullMessage: string;
}> {
  const ui = await getOKXConnectUI();
  if (!ui.connected()) throw new Error("OKX not connected");

  // Use the universal provider to sign
  const provider = (ui as any).universalProvider ?? ui;

  const result = await provider.request(
    {
      method: "aptos_signMessage",
      params: { message, nonce },
    },
    "aptos",
  );

  return {
    signature: result.signature ?? result,
    fullMessage:
      result.fullMessage ?? `APTOS\nmessage: ${message}\nnonce: ${nonce}`,
  };
}

export async function signTransactionOKX(
  transactionBytes: Uint8Array,
): Promise<Uint8Array> {
  const ui = await getOKXConnectUI();
  if (!ui.connected()) throw new Error("OKX not connected");

  const provider = (ui as any).universalProvider ?? ui;

  const result = await provider.request(
    {
      method: "aptos_signTransaction",
      params: {
        transaction: Buffer.from(transactionBytes).toString("hex"),
      },
    },
    "aptos",
  );

  // Result should be the signed transaction bytes
  if (typeof result === "string") {
    const hex = result.replace(/^0x/, "");
    return new Uint8Array(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
  }

  return new Uint8Array(result);
}
