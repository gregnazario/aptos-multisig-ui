"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { AptosNetwork } from "@/lib/aptos/client";
import { getPetraWallet, isPetraInstalled } from "@/lib/wallet/petra";

interface WalletContextValue {
  connected: boolean;
  address: string | null;
  publicKey: string | null;
  network: AptosNetwork | null;
  sessionToken: string | null;
  isPetraInstalled: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  verifyIdentity: () => Promise<string>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [network, setNetwork] = useState<AptosNetwork | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [petraInstalled, setPetraInstalled] = useState(false);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    setPetraInstalled(isPetraInstalled());
  }, []);

  useEffect(() => {
    const wallet = getPetraWallet();
    if (!wallet) return;

    wallet.onAccountChange((account) => {
      if (account.address) {
        setAddress(account.address);
        setPublicKey(account.publicKey);
      } else {
        setConnected(false);
        setAddress(null);
        setPublicKey(null);
      }
      setSessionToken(null);
      tokenRef.current = null;
    });

    wallet.onNetworkChange((net) => {
      setNetwork(net.name.toLowerCase() as AptosNetwork);
      setSessionToken(null);
      tokenRef.current = null;
    });
  }, []);

  const connect = useCallback(async () => {
    const wallet = getPetraWallet();
    if (!wallet) throw new Error("Petra wallet not installed");

    const account = await wallet.connect();
    const net = await wallet.network();

    setConnected(true);
    setAddress(account.address);
    setPublicKey(account.publicKey);
    setNetwork(net.name.toLowerCase() as AptosNetwork);
  }, []);

  const disconnect = useCallback(async () => {
    const wallet = getPetraWallet();
    if (wallet) await wallet.disconnect();

    setConnected(false);
    setAddress(null);
    setPublicKey(null);
    setNetwork(null);
    setSessionToken(null);
    tokenRef.current = null;
  }, []);

  const verifyIdentity = useCallback(async (): Promise<string> => {
    if (tokenRef.current) return tokenRef.current;

    const wallet = getPetraWallet();
    if (!wallet || !publicKey || !address || !network) {
      throw new Error("Wallet not connected");
    }

    const nonce = crypto.randomUUID();
    const response = await wallet.signMessage({
      message: "Aptos Multisig Verification",
      nonce,
      address: true,
      application: true,
      chainId: true,
    });

    const res = await fetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey,
        signature: response.signature,
        fullMessage: response.fullMessage,
        nonce,
        address,
        network,
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
  }, [publicKey, address, network]);

  return (
    <WalletContext.Provider
      value={{
        connected,
        address,
        publicKey,
        network,
        sessionToken,
        isPetraInstalled: petraInstalled,
        connect,
        disconnect,
        verifyIdentity,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
