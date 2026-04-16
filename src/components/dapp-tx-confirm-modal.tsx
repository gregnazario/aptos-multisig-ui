"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DappTxPayload {
  function: string;
  arguments: string[];
  type_arguments: string[];
}

interface DappTxConfirmModalProps {
  open: boolean;
  payload: DappTxPayload | null;
  dappUrl: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DappTxConfirmModal({
  open,
  payload,
  dappUrl,
  onConfirm,
  onCancel,
}: DappTxConfirmModalProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>dApp Transaction Request</DialogTitle>
          <DialogDescription>
            The dApp is requesting a transaction. Review the details below and
            create a multisig proposal.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            <p className="font-medium text-muted-foreground">Source</p>
            <p className="break-all font-mono text-xs">{dappUrl}</p>
          </div>

          {payload && (
            <>
              <div className="space-y-1">
                <p className="font-medium text-muted-foreground">Function</p>
                <p className="break-all font-mono text-xs">
                  {payload.function}
                </p>
              </div>

              {payload.type_arguments.length > 0 && (
                <div className="space-y-1">
                  <p className="font-medium text-muted-foreground">
                    Type Arguments
                  </p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {payload.type_arguments.map((arg, i) => (
                      <li key={i} className="break-all font-mono text-xs">
                        {arg}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {payload.arguments.length > 0 && (
                <div className="space-y-1">
                  <p className="font-medium text-muted-foreground">
                    Function Arguments
                  </p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {payload.arguments.map((arg, i) => (
                      <li key={i} className="break-all font-mono text-xs">
                        {String(arg)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Create Proposal</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
