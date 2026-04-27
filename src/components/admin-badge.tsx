"use client";

import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useWallet } from "@/components/wallet-provider";

export function AdminBadge() {
  const { isAdmin, connected } = useWallet();
  if (!connected || !isAdmin) return null;
  return (
    <Badge
      className="bg-amber-500 text-white hover:bg-amber-500"
      title="This wallet is an admin and can create proposals on any multisig."
    >
      <ShieldCheck className="mr-1 h-3 w-3" />
      Admin
    </Badge>
  );
}
