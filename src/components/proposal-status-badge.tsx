import { Badge } from "@/components/ui/badge";

/**
 * Resolve a proposal's effective status — collapses `pending` past
 * `expirationTimestampSecs` into `expired` so the badge matches reality.
 */
export function effectiveProposalStatus(
  status: string,
  expirationTimestampSecs: number,
): string {
  if (status === "pending" || status === "ready") {
    if (expirationTimestampSecs < Math.floor(Date.now() / 1000)) {
      return "expired";
    }
  }
  return status;
}

/**
 * A small color-coded badge for a proposal status. Colors are tuned for
 * easy scanning of a list of proposals:
 *
 *   pending   amber   — needs more signatures
 *   ready     green   — threshold met, ready to submit
 *   submitted blue    — sent to chain (awaiting / unknown outcome)
 *   confirmed emerald — succeeded on chain
 *   expired   orange  — passed expiration without landing
 *   failed    red     — chain rejected
 *   cancelled slate   — killed by a signer/admin
 */
export function ProposalStatusBadge({
  status,
  expirationTimestampSecs,
}: {
  status: string;
  /** When supplied, `pending`/`ready` past this time render as `expired`. */
  expirationTimestampSecs?: number;
}) {
  const resolved =
    expirationTimestampSecs !== undefined
      ? effectiveProposalStatus(status, expirationTimestampSecs)
      : status;

  const styles: Record<string, string> = {
    pending: "bg-amber-500 text-white hover:bg-amber-500",
    ready: "bg-green-600 text-white hover:bg-green-600",
    submitted: "bg-blue-600 text-white hover:bg-blue-600",
    confirmed: "bg-emerald-600 text-white hover:bg-emerald-600",
    expired: "bg-orange-600 text-white hover:bg-orange-600",
    failed: "bg-red-600 text-white hover:bg-red-600",
    cancelled: "bg-slate-500 text-white hover:bg-slate-500",
  };

  const label =
    resolved.length > 0
      ? resolved[0].toUpperCase() + resolved.slice(1)
      : resolved;
  const className = styles[resolved];
  if (!className) {
    return <Badge variant="secondary">{label}</Badge>;
  }
  return <Badge className={className}>{label}</Badge>;
}
