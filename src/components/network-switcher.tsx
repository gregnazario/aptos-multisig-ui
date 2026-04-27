"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWallet } from "@/components/wallet-provider";
import type { AptosNetwork } from "@/lib/aptos/client";

const NETWORKS: { value: AptosNetwork; label: string }[] = [
  { value: "mainnet", label: "Mainnet" },
  { value: "testnet", label: "Testnet" },
  { value: "devnet", label: "Devnet" },
];

const NETWORK_QUERY_PARAM = "network";

function isAptosNetwork(value: string | null): value is AptosNetwork {
  return value === "mainnet" || value === "testnet" || value === "devnet";
}

export function NetworkSwitcher() {
  const { network, switchNetwork } = useWallet();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlNetwork = searchParams.get(NETWORK_QUERY_PARAM);

  // Sync URL -> wallet state. Handles initial load, back/forward, and
  // direct navigation with a `network` query param.
  useEffect(() => {
    if (isAptosNetwork(urlNetwork) && urlNetwork !== network) {
      switchNetwork(urlNetwork);
    }
  }, [urlNetwork, network, switchNetwork]);

  const handleChange = (next: AptosNetwork) => {
    switchNetwork(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set(NETWORK_QUERY_PARAM, next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  };

  return (
    <Select
      value={network}
      onValueChange={(v) => handleChange(v as AptosNetwork)}
    >
      <SelectTrigger className="w-[130px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {NETWORKS.map((n) => (
          <SelectItem key={n.value} value={n.value}>
            {n.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
