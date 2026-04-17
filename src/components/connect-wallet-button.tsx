"use client";

import { useWallet as useAdapterWallet } from "@aptos-labs/wallet-adapter-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWallet } from "@/components/wallet-provider";
import { connectOKX, disconnectOKX, isOKXConnected } from "@/lib/okx-connect";

export function ConnectWalletButton() {
  const adapter = useAdapterWallet();
  const wallet = useWallet();
  const { address, keyError } = wallet;
  const [okxConnecting, setOkxConnecting] = useState(false);

  // Connected with key error
  if ((adapter.connected || isOKXConnected()) && keyError) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-destructive max-w-48 leading-tight">
          Non-Ed25519 key detected
        </span>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            adapter.disconnect();
            disconnectOKX();
          }}
        >
          Disconnect
        </Button>
      </div>
    );
  }

  // Connected via OKX Connect
  if (wallet.connectedVia === "okx" && address) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px]">OKX</Badge>
        <Button
          variant="outline"
          onClick={() => {
            disconnectOKX();
            wallet.clearOKXConnection();
          }}
        >
          {address.slice(0, 6)}...{address.slice(-4)}
        </Button>
      </div>
    );
  }

  // Connected via standard adapter
  if (adapter.connected && address) {
    return (
      <Button variant="outline" onClick={() => adapter.disconnect()}>
        {address.slice(0, 6)}...{address.slice(-4)}
      </Button>
    );
  }

  // Not connected — show wallet options
  if (!adapter.wallets) {
    return <Button disabled>Loading...</Button>;
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

  async function handleOKXConnect() {
    setOkxConnecting(true);
    try {
      const account = await connectOKX(wallet.network);
      wallet.setOKXConnection(account.address, account.publicKey);
    } catch (err) {
      console.error("OKX Connect failed:", err);
    } finally {
      setOkxConnecting(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button />}>
        Connect Wallet
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
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleOKXConnect} disabled={okxConnecting}>
          {okxConnecting ? "Connecting..." : "OKX Mobile (QR Code)"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
