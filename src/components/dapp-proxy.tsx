"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/components/wallet-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { DappTxConfirmModal } from "@/components/dapp-tx-confirm-modal";
import type { AptosNetwork } from "@/lib/aptos/client";

interface DappProxyProps {
  multisigAddress: string;
  network: AptosNetwork;
  publicKeys: string[];
  threshold: number;
}

interface PendingRequest {
  id: number;
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any;
}

const PRESET_DAPPS = [
  { label: "Aries Markets", url: "https://app.ariesmarkets.xyz" },
];

export function DappProxy({
  multisigAddress,
  network,
  publicKeys,
  threshold,
}: DappProxyProps) {
  const { verifyIdentity } = useWallet();
  const router = useRouter();

  const [dappUrl, setDappUrl] = useState("");
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(true);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<PendingRequest | null>(
    null
  );

  const iframeRef = useRef<HTMLIFrameElement>(null);

  function handleLoad() {
    const url = dappUrl.trim();
    if (!url) return;
    const fullUrl = url.startsWith("http") ? url : `https://${url}`;
    setLoadedUrl(fullUrl);
    setError(null);
    setSheetOpen(false);
  }

  function sendResponse(id: number, result: unknown, error?: string) {
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "MULTISIG_WALLET_RESPONSE",
        id,
        result: error ? undefined : result,
        error,
      },
      "*"
    );
  }

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (event.data?.type !== "MULTISIG_WALLET_REQUEST") return;

      const { id, method, params } = event.data;

      switch (method) {
        case "connect":
        case "account":
          sendResponse(id, { address: multisigAddress });
          break;

        case "network":
          sendResponse(id, network);
          break;

        case "isConnected":
          sendResponse(id, true);
          break;

        case "disconnect":
          sendResponse(id, undefined);
          break;

        case "signTransaction":
        case "signAndSubmitTransaction":
          setPendingRequest({ id, method, params });
          setConfirmOpen(true);
          break;

        case "signMessage":
          sendResponse(
            id,
            undefined,
            "signMessage is not supported for multisig wallets"
          );
          break;

        default:
          sendResponse(id, undefined, `Unsupported method: ${method}`);
      }
    },
    [multisigAddress, network]
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  async function handleConfirm() {
    if (!pendingRequest) return;

    setLoading(true);
    setError(null);

    try {
      const token = await verifyIdentity();

      const dappPayload = pendingRequest.params;
      const fnParts = (dappPayload.function ?? "").split("::");
      const moduleAddr =
        fnParts.length >= 2
          ? fnParts.slice(0, -2).join("::") || fnParts[0]
          : "0x1";
      const moduleName =
        fnParts.length >= 2 ? fnParts[fnParts.length - 2] : "";
      const functionName =
        fnParts.length >= 1 ? fnParts[fnParts.length - 1] : "";

      const payload = {
        module: `${moduleAddr}::${moduleName}`,
        function: functionName,
        typeArgs: dappPayload.type_arguments ?? [],
        args: (dappPayload.arguments ?? []).map(String),
      };

      const body = {
        network,
        description: `dApp transaction: ${dappPayload.function ?? "unknown"}`,
        payload,
        maxGasAmount: 10000,
        gasUnitPrice: 100,
        expirationSeconds: 24 * 3600,
        source: "dapp",
        sourceDappUrl: loadedUrl,
      };

      const res = await fetch(
        `/api/multisig/${encodeURIComponent(multisigAddress)}/proposals`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to create proposal");
      }

      const data = await res.json();

      sendResponse(
        pendingRequest.id,
        undefined,
        `Transaction captured as multisig proposal. ` +
          `It requires ${threshold}-of-${publicKeys.length} signatures before submission. ` +
          `Redirecting to proposal page.`
      );

      setConfirmOpen(false);
      setPendingRequest(null);
      router.push(data.url);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to create proposal";
      setError(message);

      if (pendingRequest) {
        sendResponse(pendingRequest.id, undefined, message);
      }

      setConfirmOpen(false);
      setPendingRequest(null);
    } finally {
      setLoading(false);
    }
  }

  function handleCancel() {
    if (pendingRequest) {
      sendResponse(pendingRequest.id, undefined, "User rejected the request");
    }
    setConfirmOpen(false);
    setPendingRequest(null);
  }

  return (
    <div className="fixed inset-0 flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b bg-background px-3 py-2 shrink-0">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger render={<Button variant="outline" size="sm" />}>
            Settings
          </SheetTrigger>
          <SheetContent side="left" className="w-80 sm:max-w-sm">
            <SheetHeader>
              <SheetTitle>dApp Browser</SheetTitle>
              <SheetDescription>
                Interact with dApps using your multisig wallet (
                {multisigAddress.slice(0, 8)}...{multisigAddress.slice(-6)}).
                Transactions become {threshold}-of-{publicKeys.length} proposals.
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-4 p-4">
              {/* Presets */}
              <div className="space-y-2">
                <Label>Presets</Label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_DAPPS.map((preset) => (
                    <Button
                      key={preset.url}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDappUrl(preset.url);
                        const fullUrl = preset.url.startsWith("http")
                          ? preset.url
                          : `https://${preset.url}`;
                        setLoadedUrl(fullUrl);
                        setError(null);
                        setSheetOpen(false);
                      }}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* URL input */}
              <div className="space-y-2">
                <Label htmlFor="dappUrl">Custom URL</Label>
                <Input
                  id="dappUrl"
                  placeholder="https://example.com"
                  value={dappUrl}
                  onChange={(e) => setDappUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLoad()}
                />
                <Button
                  onClick={handleLoad}
                  disabled={!dappUrl.trim()}
                  className="w-full"
                >
                  Load
                </Button>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>
          </SheetContent>
        </Sheet>

        {loadedUrl && (
          <span className="text-xs text-muted-foreground truncate">
            {loadedUrl}
          </span>
        )}

        {loading && (
          <span className="text-xs text-muted-foreground ml-auto">
            Creating proposal...
          </span>
        )}
      </div>

      {/* Full-view iframe */}
      {loadedUrl ? (
        <iframe
          ref={iframeRef}
          src={loadedUrl}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          className="flex-1 w-full border-0"
          title="dApp Browser"
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <p>Open the settings panel to load a dApp.</p>
        </div>
      )}

      {/* Transaction confirmation modal */}
      <DappTxConfirmModal
        open={confirmOpen}
        payload={
          pendingRequest?.params
            ? {
                function: pendingRequest.params.function ?? "",
                arguments: (pendingRequest.params.arguments ?? []).map(String),
                type_arguments: pendingRequest.params.type_arguments ?? [],
              }
            : null
        }
        dappUrl={loadedUrl ?? ""}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </div>
  );
}
