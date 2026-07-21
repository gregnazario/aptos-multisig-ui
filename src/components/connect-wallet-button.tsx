"use client";

import { useWallet as useAdapterWallet } from "@aptos-labs/wallet-adapter-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWallet } from "@/components/wallet-provider";

export function ConnectWalletButton() {
  const adapter = useAdapterWallet();
  const wallet = useWallet();
  const { address, keyError } = wallet;

  // Connected with key error
  if (adapter.connected && keyError) {
    return (
      <div className="flex max-w-full items-center gap-2">
        <span className="max-w-28 text-xs leading-tight text-destructive sm:max-w-48">
          Non-Ed25519 key detected
        </span>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => adapter.disconnect()}
        >
          Disconnect
        </Button>
      </div>
    );
  }

  // Connected via standard adapter
  if (adapter.connected && address) {
    return (
      <Button variant="outline" size="sm" onClick={() => adapter.disconnect()}>
        <span className="font-mono text-xs sm:text-sm">
          {address.slice(0, 6)}...{address.slice(-4)}
        </span>
      </Button>
    );
  }

  // Not connected — show wallet options
  if (!adapter.wallets) {
    return (
      <Button disabled size="sm">
        Loading...
      </Button>
    );
  }

  // Filter out keyless/social login wallets — they use non-Ed25519 keys
  // which are incompatible with MultiEd25519 multisig.
  const BLOCKED_WALLETS = [
    "continue with google",
    "continue with apple",
    "petra web",
    "aptos connect",
    "google",
    "apple",
  ];
  const availableWallets = adapter.wallets.filter(
    (w) => !BLOCKED_WALLETS.includes(w.name.toLowerCase()),
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" />}>
        <span className="sm:hidden">Connect</span>
        <span className="hidden sm:inline">Connect Wallet</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
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
