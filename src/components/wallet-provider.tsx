"use client";

import { Network } from "@aptos-labs/ts-sdk";
import {
  AptosWalletAdapterProvider,
  useWallet as useAdapterWallet,
} from "@aptos-labs/wallet-adapter-react";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import type { AptosNetwork } from "@/lib/aptos/client";
import { signMessageOKX } from "@/lib/okx-connect";

const networkToEnum: Record<AptosNetwork, Network> = {
  mainnet: Network.MAINNET,
  testnet: Network.TESTNET,
  devnet: Network.DEVNET,
};

interface MultisigWalletContextValue {
  connected: boolean;
  address: string | null;
  publicKey: string | null;
  /** Non-null if the connected wallet uses a non-Ed25519 key */
  keyError: string | null;
  /** Which wallet is connected: "adapter" (Petra etc.), "okx", or null */
  connectedVia: "adapter" | "okx" | null;
  network: AptosNetwork;
  switchNetwork: (network: AptosNetwork) => void;
  sessionToken: string | null;
  verifyIdentity: () => Promise<string>;
  /** Set OKX connection state (called from connect button) */
  setOKXConnection: (address: string, publicKey: string) => void;
  /** Clear OKX connection state */
  clearOKXConnection: () => void;
}

const MultisigWalletContext = createContext<MultisigWalletContextValue | null>(
  null,
);

function MultisigWalletInner({
  children,
  initialNetwork,
}: {
  children: React.ReactNode;
  initialNetwork: AptosNetwork;
}) {
  const adapter = useAdapterWallet();
  const [selectedNetwork, setSelectedNetwork] =
    useState<AptosNetwork>(initialNetwork);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  // OKX Connect state
  const [okxAddress, setOkxAddress] = useState<string | null>(null);
  const [okxPublicKey, setOkxPublicKey] = useState<string | null>(null);

  // Determine which connection is active
  const connectedVia: "adapter" | "okx" | null = adapter.connected
    ? "adapter"
    : okxAddress
      ? "okx"
      : null;

  // Resolve address/publicKey from whichever is connected
  const address =
    connectedVia === "adapter"
      ? (adapter.account?.address?.toString() ?? null)
      : connectedVia === "okx"
        ? okxAddress
        : null;

  const rawPublicKey =
    connectedVia === "adapter"
      ? (adapter.account?.publicKey?.toString() ?? null)
      : connectedVia === "okx"
        ? okxPublicKey
        : null;

  // Validate Ed25519
  const isEd25519 =
    rawPublicKey !== null && /^0x[0-9a-fA-F]{64}$/.test(rawPublicKey);
  const publicKey = isEd25519 ? rawPublicKey : null;
  const keyError =
    connectedVia && rawPublicKey && !isEd25519
      ? "This wallet uses a keyless or non-Ed25519 key, which is incompatible with MultiEd25519 multisig."
      : null;

  const switchNetwork = useCallback(
    (net: AptosNetwork) => {
      setSelectedNetwork(net);
      setSessionToken(null);
      tokenRef.current = null;
      if (connectedVia === "adapter") {
        adapter.changeNetwork(networkToEnum[net]).catch(() => {});
      }
    },
    [adapter, connectedVia],
  );

  const setOKXConnection = useCallback(
    (addr: string, pk: string) => {
      setOkxAddress(addr);
      setOkxPublicKey(pk);
      setSessionToken(null);
      tokenRef.current = null;
    },
    [],
  );

  const clearOKXConnection = useCallback(() => {
    setOkxAddress(null);
    setOkxPublicKey(null);
    setSessionToken(null);
    tokenRef.current = null;
  }, []);

  const verifyIdentity = useCallback(async (): Promise<string> => {
    if (tokenRef.current) return tokenRef.current;
    if (!connectedVia || !address || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const nonce = crypto.randomUUID();
    let signature: string;
    let fullMessage: string;

    if (connectedVia === "adapter") {
      const signResult = await adapter.signMessage({
        message: "Aptos Multisig Verification",
        nonce,
      });
      signature = signResult.signature.toString();
      fullMessage = signResult.fullMessage;
    } else {
      // OKX Connect
      const result = await signMessageOKX(
        "Aptos Multisig Verification",
        nonce,
      );
      signature = result.signature;
      fullMessage = result.fullMessage;
    }

    const res = await fetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey,
        signature,
        fullMessage,
        nonce,
        address,
        network: selectedNetwork,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? "Verification failed");
    }

    const { token } = await res.json();
    setSessionToken(token);
    tokenRef.current = token;
    return token;
  }, [adapter, connectedVia, address, publicKey, selectedNetwork]);

  return (
    <MultisigWalletContext.Provider
      value={{
        connected: connectedVia !== null,
        address,
        publicKey,
        keyError,
        connectedVia,
        network: selectedNetwork,
        switchNetwork,
        sessionToken,
        verifyIdentity,
        setOKXConnection,
        clearOKXConnection,
      }}
    >
      {children}
    </MultisigWalletContext.Provider>
  );
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [network] = useState<AptosNetwork>("devnet");

  return (
    <AptosWalletAdapterProvider
      autoConnect={true}
      dappConfig={{ network: networkToEnum[network] }}
      onError={(error) => console.error("Wallet adapter error:", error)}
    >
      <MultisigWalletInner initialNetwork={network}>
        {children}
      </MultisigWalletInner>
    </AptosWalletAdapterProvider>
  );
}

export function useWallet() {
  const context = useContext(MultisigWalletContext);
  if (!context) {
    throw new Error("useWallet must be used within WalletProvider");
  }
  return context;
}
