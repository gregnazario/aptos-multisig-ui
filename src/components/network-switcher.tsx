"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWallet } from "@/components/wallet-provider";
import type { AptosNetwork } from "@/lib/aptos/client";

const NETWORKS = [
  { value: "mainnet", label: "Mainnet" },
  { value: "testnet", label: "Testnet" },
  { value: "devnet", label: "Devnet" },
];

export function NetworkSwitcher() {
  const { network, switchNetwork } = useWallet();
  return (
    <Select
      value={network}
      onValueChange={(v) => switchNetwork(v as AptosNetwork)}
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
