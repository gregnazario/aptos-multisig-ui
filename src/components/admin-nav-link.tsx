"use client";

import Link from "next/link";
import { useWallet } from "@/components/wallet-provider";

/**
 * Header link to the admin page. Rendered only when the connected wallet is in
 * the admin allowlist (passive check via {@link useWallet}). The /admin page
 * still enforces admin authorization server-side via a signed JWT.
 */
export function AdminNavLink() {
  const { connected, isAdmin } = useWallet();
  if (!connected || !isAdmin) return null;
  return (
    <Link
      href="/admin"
      className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      Admin
    </Link>
  );
}
