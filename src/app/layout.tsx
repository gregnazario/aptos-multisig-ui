import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ConnectWalletButton } from "@/components/connect-wallet-button";
import { NetworkSwitcher } from "@/components/network-switcher";
import { WalletProvider } from "@/components/wallet-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Aptos Multisig",
  description: "Aptos MultiEd25519 multisig management UI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <WalletProvider>
          <header className="flex items-center justify-between border-b px-4 py-3">
            <h1 className="text-lg font-semibold">Aptos Multisig</h1>
            <div className="flex items-center gap-2">
              <NetworkSwitcher />
              <ConnectWalletButton />
            </div>
          </header>
          <main className="p-4">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
