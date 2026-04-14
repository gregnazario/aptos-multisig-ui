"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWallet } from "@/components/wallet-provider";

const NETWORKS = [
  { value: "mainnet", label: "Mainnet" },
  { value: "testnet", label: "Testnet" },
  { value: "devnet", label: "Devnet" },
];

export function NetworkSwitcher() {
  const { network } = useWallet();
  return (
    <Select value={network ?? "mainnet"} disabled>
      <SelectTrigger className="w-[130px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {NETWORKS.map((n) => (
          <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
