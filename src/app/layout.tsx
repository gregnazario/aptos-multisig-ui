import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type React from "react";
import { Suspense } from "react";
import "./globals.css";
import { ActiveMultisigBanner } from "@/components/active-multisig-banner";
import { AdminBadge } from "@/components/admin-badge";
import { ConnectWalletButton } from "@/components/connect-wallet-button";
import { NetworkSwitcher } from "@/components/network-switcher";
import { SiteFooter } from "@/components/site-footer";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
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
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <WalletProvider>
            <header className="sticky top-0 z-40 flex items-center justify-between border-b bg-card/80 backdrop-blur-sm px-6 py-3 shadow-sm">
              <a href="/" className="text-lg font-bold tracking-tight">
                Aptos Multisig
              </a>
              <div className="flex items-center gap-3">
                <AdminBadge />
                <Suspense
                  fallback={<div className="w-[130px] h-9 rounded-md border" />}
                >
                  <NetworkSwitcher />
                </Suspense>
                <ThemeToggle />
                <ConnectWalletButton />
              </div>
            </header>
            <Suspense fallback={null}>
              <ActiveMultisigBanner />
            </Suspense>
            <main className="flex-1 p-6">{children}</main>
            <SiteFooter />
          </WalletProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
