"use client";

import {
  type BalanceChange,
  BalanceChanges,
} from "@/components/balance-changes";
import { Badge } from "@/components/ui/badge";

export interface SimulationResultData {
  success: boolean;
  vmStatus: string;
  gasUsed: string;
  events: { type: string; data: unknown }[];
  changes: { type: string; address?: string; resource?: string }[];
  balanceChanges?: BalanceChange[];
}

interface SimulationResultProps {
  simulation: SimulationResultData;
  /** Tailwind text-size class for body rows (matches caller typography). */
  textSize?: "text-xs" | "text-sm";
}

/**
 * Shared renderer for the result of a transaction simulation: status, gas
 * used, emitted events, and state changes. Used by both the proposal builder
 * (while composing a new proposal) and the proposal view (dry-running an
 * existing one) — they previously rendered near-identical JSX inline.
 */
export function SimulationResult({
  simulation,
  textSize = "text-sm",
}: SimulationResultProps) {
  return (
    <>
      <div className={`grid grid-cols-2 gap-4 ${textSize}`}>
        <div>
          <span className="text-muted-foreground">Status: </span>
          <span
            className={simulation.success ? "text-green-600" : "text-red-600"}
          >
            {simulation.vmStatus}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Gas Used: </span>
          {simulation.gasUsed}
        </div>
      </div>

      {simulation.balanceChanges && simulation.balanceChanges.length > 0 && (
        <BalanceChanges changes={simulation.balanceChanges} />
      )}

      {simulation.events.length > 0 && (
        <div className="space-y-2">
          <p className={`font-medium ${textSize}`}>
            Events ({simulation.events.length})
          </p>
          <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/50 p-2 space-y-2">
            {simulation.events.map((event, i) => (
              <div key={i} className="text-xs">
                <code className="text-primary font-medium">{event.type}</code>
                <pre className="mt-1 text-muted-foreground overflow-x-auto">
                  {JSON.stringify(event.data, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {simulation.changes.length > 0 && (
        <div className="space-y-2">
          <p className={`font-medium ${textSize}`}>
            State Changes ({simulation.changes.length})
          </p>
          <div className="max-h-36 overflow-y-auto rounded-md border bg-muted/50 p-2 space-y-1">
            {simulation.changes.map((change, i) => (
              <div key={i} className="text-xs">
                <Badge variant="outline" className="text-[10px] mr-1">
                  {change.type}
                </Badge>
                {change.resource && (
                  <code className="text-muted-foreground">
                    {change.resource}
                  </code>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** Badge matching a simulation's pass/fail outcome. */
export function SimulationStatusBadge({
  simulation,
}: {
  simulation: SimulationResultData;
}) {
  return (
    <Badge
      className={
        simulation.success ? "bg-green-600 text-white" : "bg-red-600 text-white"
      }
    >
      {simulation.success ? "Success" : "Failed"}
    </Badge>
  );
}
