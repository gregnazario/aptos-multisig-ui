import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type React from "react";
import { Suspense } from "react";
import "./globals.css";
import { ActiveMultisigBanner } from "@/components/active-multisig-banner";
import { AdminBadge } from "@/components/admin-badge";
import { AdminNavLink } from "@/components/admin-nav-link";
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
      <body className="flex min-h-full flex-col overflow-x-clip bg-background">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <WalletProvider>
            <header className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur-sm px-4 py-3 shadow-sm sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <a
                  href="/"
                  className="shrink-0 text-base font-bold tracking-tight sm:text-lg"
                >
                  Aptos Multisig
                </a>
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 sm:gap-3">
                  <AdminNavLink />
                  <AdminBadge />
                  <Suspense
                    fallback={
                      <div className="h-9 w-[7.5rem] rounded-md border sm:w-[130px]" />
                    }
                  >
                    <NetworkSwitcher />
                  </Suspense>
                  <ThemeToggle />
                  <ConnectWalletButton />
                </div>
              </div>
            </header>
            <Suspense fallback={null}>
              <ActiveMultisigBanner />
            </Suspense>
            <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
            <SiteFooter />
          </WalletProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
