"use client";

import { Network } from "@aptos-labs/ts-sdk";
import {
  AptosWalletAdapterProvider,
  useWallet as useAdapterWallet,
} from "@aptos-labs/wallet-adapter-react";
import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
  /** Non-null if the connected wallet uses a non-Ed25519 key */
  keyError: string | null;
  network: AptosNetwork;
  switchNetwork: (network: AptosNetwork) => void;
  sessionToken: string | null;
  verifyIdentity: () => Promise<string>;
  /**
   * True when the connected wallet's public key derives to an address listed
   * in the server's APTOS_ADMIN_ADDRESSES allowlist. Determined via a passive
   * lookup against /api/admin/check; no signature required to populate it.
   */
  isAdmin: boolean;
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
  const [isAdmin, setIsAdmin] = useState(false);
  const tokenRef = useRef<string | null>(null);

  const address = adapter.connected
    ? (adapter.account?.address?.toString() ?? null)
    : null;

  const rawPublicKey = adapter.connected
    ? (adapter.account?.publicKey?.toString() ?? null)
    : null;

  // Validate Ed25519
  const isEd25519 =
    rawPublicKey !== null && /^0x[0-9a-fA-F]{64}$/.test(rawPublicKey);
  const publicKey = isEd25519 ? rawPublicKey : null;
  const keyError =
    adapter.connected && rawPublicKey && !isEd25519
      ? "This wallet uses a keyless or non-Ed25519 key, which is incompatible with MultiEd25519 multisig."
      : null;

  // Passively check admin status whenever the connected public key changes.
  // Admin status is a function of the public key alone (and the server-side
  // allowlist), so we don't need a signed session to display the badge.
  useEffect(() => {
    if (!publicKey) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    fetch(`/api/admin/check?publicKey=${encodeURIComponent(publicKey)}`)
      .then((r) => (r.ok ? r.json() : { isAdmin: false }))
      .then((data: { isAdmin?: boolean }) => {
        if (!cancelled) setIsAdmin(Boolean(data.isAdmin));
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  const switchNetwork = useCallback(
    (net: AptosNetwork) => {
      setSelectedNetwork(net);
      setSessionToken(null);
      setIsAdmin(false);
      tokenRef.current = null;
      if (adapter.connected) {
        adapter.changeNetwork(networkToEnum[net]).catch(() => {});
      }
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

    const { token, isAdmin: adminFlag } = (await res.json()) as {
      token: string;
      isAdmin?: boolean;
    };
    setSessionToken(token);
    setIsAdmin(Boolean(adminFlag));
    tokenRef.current = token;
    return token;
  }, [adapter, address, publicKey, selectedNetwork]);

  return (
    <MultisigWalletContext.Provider
      value={{
        connected: adapter.connected,
        address,
        publicKey,
        keyError,
        network: selectedNetwork,
        switchNetwork,
        sessionToken,
        verifyIdentity,
        isAdmin,
      }}
    >
      {children}
    </MultisigWalletContext.Provider>
  );
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [network] = useState<AptosNetwork>("mainnet");

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
