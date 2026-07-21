"use client";

import { Badge } from "@/components/ui/badge";

interface SignerResponse {
  signerIndex: number;
  publicKey: string;
  response: string;
  declineReason?: string | null;
}

interface SignerStatusGridProps {
  publicKeys: string[];
  responses: SignerResponse[];
  threshold: number;
}

function truncateKey(key: string): string {
  if (key.length <= 18) return key;
  return `${key.slice(0, 10)}...${key.slice(-8)}`;
}

export function SignerStatusGrid({
  publicKeys,
  responses,
  threshold,
}: SignerStatusGridProps) {
  const signedCount = responses.filter((r) => r.response === "signed").length;

  const getStatus = (publicKey: string) => {
    const response = responses.find(
      (r) => r.publicKey.toLowerCase() === publicKey.toLowerCase(),
    );
    if (!response) return "pending";
    return response.response;
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">
        Signatures: {signedCount} / {threshold} required
      </p>
      <div className="space-y-2">
        {publicKeys.map((key, index) => {
          const status = getStatus(key);
          return (
            <div
              key={key}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="w-6 shrink-0 text-right text-muted-foreground">
                  {index}
                </span>
                <code className="truncate text-xs" title={key}>
                  {truncateKey(key)}
                </code>
              </div>
              {status === "signed" ? (
                <Badge className="bg-green-600 text-white">Signed</Badge>
              ) : status === "declined" ? (
                <Badge variant="destructive">Declined</Badge>
              ) : (
                <Badge variant="secondary">Pending</Badge>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
