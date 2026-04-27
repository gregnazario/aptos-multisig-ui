"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { AptosNetwork } from "@/lib/aptos/client";

interface ActiveMultisig {
  address: string;
  network: AptosNetwork;
  label?: string | null;
}

function truncateAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

/**
 * A thin context bar that appears below the global header on any subpage
 * tied to a specific multisig (the multisig dashboard, its propose/dapp
 * subroutes, and any proposal page). Renders nothing on pages with no
 * active multisig (home, create, import, etc).
 *
 * Detection rules:
 *  - `/multisig/<addr>/...`  → address from path, network from `?network=`.
 *  - `/tx/<proposalId>`      → fetch `/api/proposal/<id>` for the address.
 *  - `/tx/sign#<encoded>`    → derive address from the encoded URL payload.
 */
export function ActiveMultisigBanner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState<ActiveMultisig | null>(null);
  const [copied, setCopied] = useState(false);

  // Source 1: /multisig/<addr>/... — address is in the path.
  const fromPath = useMemo<ActiveMultisig | null>(() => {
    const m = pathname?.match(/^\/multisig\/(0x[0-9a-fA-F]+)(?:\/|$)/);
    if (!m) return null;
    const network = (searchParams?.get("network") ?? "mainnet") as AptosNetwork;
    return { address: m[1], network };
  }, [pathname, searchParams]);

  // Source 2: /tx/<proposalId> — fetch the proposal to discover its multisig.
  // Source 3: /tx/sign — decode the URL hash client-side to derive the address.
  useEffect(() => {
    if (fromPath) {
      setActive(fromPath);
      return;
    }

    // /tx/sign — derive from URL hash.
    if (pathname === "/tx/sign") {
      let cancelled = false;
      (async () => {
        const hash = window.location.hash.slice(1);
        if (!hash) return;
        const [{ decodeProposalUrl }, { deriveMultisigAddress }] =
          await Promise.all([
            import("@/lib/url-state"),
            import("@/lib/aptos/multisig"),
          ]);
        const decoded = decodeProposalUrl(hash);
        if (!decoded) return;
        try {
          const { address } = deriveMultisigAddress(decoded.pks, decoded.th);
          if (!cancelled) {
            setActive({ address, network: decoded.net as AptosNetwork });
          }
        } catch {
          /* invalid encoded payload */
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    // /tx/<proposalId>
    const txMatch = pathname?.match(/^\/tx\/([^/]+)$/);
    if (txMatch && txMatch[1] !== "sign") {
      const id = txMatch[1];
      let cancelled = false;
      fetch(`/api/proposal/${encodeURIComponent(id)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (cancelled || !data?.multisig?.address) return;
          setActive({
            address: data.multisig.address,
            network: data.multisig.network as AptosNetwork,
            label: data.multisig.label,
          });
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }

    setActive(null);
  }, [pathname, fromPath]);

  // Best-effort label fetch when we have an address+network but no label yet.
  useEffect(() => {
    if (!active || active.label !== undefined) return;
    let cancelled = false;
    fetch(
      `/api/multisig/${encodeURIComponent(active.address)}?network=${active.network}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { label?: string | null } | null) => {
        if (cancelled) return;
        setActive((prev) =>
          prev && prev.address === active.address
            ? { ...prev, label: data?.label ?? null }
            : prev,
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active]);

  if (!active) return null;

  async function handleCopy() {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(active.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="border-b bg-muted/40 px-6 py-2 text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-muted-foreground">Multisig:</span>
        {active.label && (
          <Link
            href={`/multisig/${active.address}?network=${active.network}`}
            className="font-medium hover:underline"
          >
            {active.label}
          </Link>
        )}
        <Link
          href={`/multisig/${active.address}?network=${active.network}`}
          className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
          title={active.address}
        >
          {truncateAddress(active.address)}
        </Link>
        <Badge variant="outline" className="text-xs">
          {active.network}
        </Badge>
        <button
          type="button"
          onClick={handleCopy}
          className="text-muted-foreground hover:text-foreground"
          title="Copy address"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
        <a
          href={`https://explorer.aptoslabs.com/account/${active.address}?network=${active.network}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground"
          title="Open in Aptos Explorer"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}
