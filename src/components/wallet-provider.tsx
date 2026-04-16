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

const networkToEnum: Record<AptosNetwork, Network> = {
  mainnet: Network.MAINNET,
  testnet: Network.TESTNET,
  devnet: Network.DEVNET,
};

interface MultisigWalletContextValue {
  connected: boolean;
  address: string | null;
  publicKey: string | null;
  network: AptosNetwork;
  switchNetwork: (network: AptosNetwork) => void;
  sessionToken: string | null;
  verifyIdentity: () => Promise<string>;
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

  const address = adapter.account?.address?.toString() ?? null;
  const publicKey = adapter.account?.publicKey?.toString() ?? null;

  const switchNetwork = useCallback(
    (net: AptosNetwork) => {
      setSelectedNetwork(net);
      setSessionToken(null);
      tokenRef.current = null;
      adapter.changeNetwork(networkToEnum[net]).catch(() => {
        // Not all wallets support programmatic network switching
      });
    },
    [adapter],
  );

  const verifyIdentity = useCallback(async (): Promise<string> => {
    if (tokenRef.current) return tokenRef.current;
    if (!adapter.connected || !address || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const nonce = crypto.randomUUID();
    const signResult = await adapter.signMessage({
      message: "Aptos Multisig Verification",
      nonce,
    });

    // signResult.signature is an SDK Signature object; convert to string
    const signature = signResult.signature.toString();
    const fullMessage = signResult.fullMessage;

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
  }, [adapter, address, publicKey, selectedNetwork]);

  return (
    <MultisigWalletContext.Provider
      value={{
        connected: adapter.connected,
        address,
        publicKey,
        network: selectedNetwork,
        switchNetwork,
        sessionToken,
        verifyIdentity,
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
      optInWallets={["Petra"]}
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
