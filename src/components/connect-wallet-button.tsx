"use client";

import { useWallet } from "@/components/wallet-provider";

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function ConnectWalletButton() {
  const { connected, address, isPetraInstalled, connect, disconnect } =
    useWallet();

  if (!isPetraInstalled) {
    return (
      <a
        href="https://petra.app"
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Install Petra
      </a>
    );
  }

  if (connected && address) {
    return (
      <button
        onClick={disconnect}
        className="rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
      >
        {truncateAddress(address)}
      </button>
    );
  }

  return (
    <button
      onClick={connect}
      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
    >
      Connect Wallet
    </button>
  );
}
