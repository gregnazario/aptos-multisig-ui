"use client";

import { useWallet as useAdapterWallet } from "@aptos-labs/wallet-adapter-react";
import { useWallet } from "@/components/wallet-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ConnectWalletButton() {
  const adapter = useAdapterWallet();
  const { address } = useWallet();

  if (adapter.connected && address) {
    return (
      <Button variant="outline" onClick={() => adapter.disconnect()}>
        {address.slice(0, 6)}...{address.slice(-4)}
      </Button>
    );
  }

  const availableWallets = adapter.wallets ?? [];

  if (availableWallets.length === 0) {
    return (
      <a href="https://petra.app" target="_blank" rel="noopener noreferrer">
        <Button variant="outline">Install Petra</Button>
      </a>
    );
  }

  if (availableWallets.length === 1) {
    return (
      <Button onClick={() => adapter.connect(availableWallets[0].name)}>
        Connect {availableWallets[0].name}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button />}>
        Connect Wallet
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {availableWallets.map((w) => (
          <DropdownMenuItem
            key={w.name}
            onClick={() => adapter.connect(w.name)}
          >
            {w.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
