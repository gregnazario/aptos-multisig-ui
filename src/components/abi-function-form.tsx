"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWallet } from "@/components/wallet-provider";

interface AbiData {
  module: string;
  function: string;
  isEntry: boolean;
  visibility: string;
  genericTypeParams: number;
  params: string[];
  returnTypes: string[];
}

interface AbiFunctionFormProps {
  moduleAddress: string;
  moduleName: string;
  functionName: string;
  /** Called when the form values change */
  onChange: (values: {
    typeArgs: string[];
    args: string[];
    abi: AbiData | null;
  }) => void;
  /** Pre-filled type args */
  initialTypeArgs?: string[];
  /** Pre-filled args */
  initialArgs?: string[];
}

/** Map Move types to user-friendly labels and placeholders */
function typeLabel(moveType: string): { label: string; placeholder: string } {
  const t = moveType.replace(/^0x1::string::String$/, "string");

  if (t === "address") return { label: "Address", placeholder: "0x..." };
  if (t === "bool") return { label: "Boolean", placeholder: "true or false" };
  if (t === "u8") return { label: "u8", placeholder: "0-255" };
  if (t === "u16") return { label: "u16", placeholder: "0-65535" };
  if (t === "u32") return { label: "u32", placeholder: "Number" };
  if (t === "u64") return { label: "u64", placeholder: "Number" };
  if (t === "u128") return { label: "u128", placeholder: "Number" };
  if (t === "u256") return { label: "u256", placeholder: "Number" };
  if (t === "string") return { label: "String", placeholder: "Text" };
  if (t === "vector<u8>") return { label: "Bytes (hex)", placeholder: "0x..." };
  if (t.startsWith("vector<"))
    return {
      label: `Vector<${t.slice(7, -1)}>`,
      placeholder: "Value",
    };
  if (t.startsWith("0x1::object::Object"))
    return { label: "Object Address", placeholder: "0x..." };
  if (t.startsWith("0x1::option::Option"))
    return {
      label: `Optional ${t.slice(20, -1)}`,
      placeholder: "Value or empty",
    };

  // Generic type parameter reference like T0, T1
  if (/^T\d+$/.test(t))
    return { label: `Type Param ${t}`, placeholder: "Value" };

  return { label: t, placeholder: "Value" };
}

/** Returns the inner type for vector<T>, or null for non-vector or vector<u8> (hex). */
function vectorInnerType(moveType: string): string | null {
  if (moveType === "vector<u8>") return null;
  if (!moveType.startsWith("vector<") || !moveType.endsWith(">")) return null;
  return moveType.slice(7, -1);
}

/** Input for vector<T> (non-bytes): one box per element, + / × to add/remove. */
function VectorInput({
  innerType,
  value,
  onChange,
}: {
  innerType: string;
  /** Comma-joined string stored by the parent. */
  value: string;
  onChange: (next: string) => void;
}) {
  const { placeholder } = typeLabel(innerType);
  const elements = value === "" ? [""] : value.split(",");

  function emit(next: string[]) {
    // Preserve the array even when all entries are empty so user can keep typing.
    onChange(next.join(","));
  }

  function updateElement(index: number, next: string) {
    const copy = [...elements];
    copy[index] = next;
    emit(copy);
  }

  function removeElement(index: number) {
    const copy = elements.filter((_, i) => i !== index);
    emit(copy.length === 0 ? [""] : copy);
  }

  function addElement() {
    emit([...elements, ""]);
  }

  return (
    <div className="space-y-2">
      {elements.map((el, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground/60 font-mono w-8 shrink-0">
            [{i}]
          </span>
          <Input
            placeholder={placeholder}
            value={el}
            onChange={(e) => updateElement(i, e.target.value)}
            className="font-mono text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => removeElement(i)}
            disabled={elements.length === 1 && el === ""}
            aria-label={`Remove element ${i}`}
            className="shrink-0 h-8 w-8 p-0"
          >
            ×
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addElement}
        className="h-7 text-xs"
      >
        + Add element
      </Button>
    </div>
  );
}

export function AbiFunctionForm({
  moduleAddress,
  moduleName,
  functionName,
  onChange,
  initialTypeArgs,
  initialArgs,
}: AbiFunctionFormProps) {
  const { network } = useWallet();
  const [abi, setAbi] = useState<AbiData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typeArgs, setTypeArgs] = useState<string[]>(initialTypeArgs ?? []);
  const [args, setArgs] = useState<string[]>(initialArgs ?? []);
  // Incremented by the Retry button to force the debounced effect to re-run.
  const [retryToken, setRetryToken] = useState(0);

  // Fetch ABI when function changes. Debounced so we don't spam the API
  // on every keystroke, and race-protected so an in-flight older request
  // can't overwrite newer results.
  const fetchAbi = useCallback(
    async (signal: AbortSignal) => {
      if (!moduleAddress || !moduleName || !functionName) {
        setAbi(null);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const module = `${moduleAddress}::${moduleName}`;
        const res = await fetch(
          `/api/multisig/abi?module=${encodeURIComponent(module)}&function=${encodeURIComponent(functionName)}&network=${network}`,
          { signal },
        );
        const data = await res.json();

        if (!res.ok) {
          setError(data.error ?? "Failed to fetch ABI");
          setAbi(null);
          return;
        }

        setAbi(data);

        // Initialize arg arrays to match param count
        setTypeArgs((prev) => {
          return Array.from(
            { length: data.genericTypeParams },
            (_, i) => prev[i] ?? "",
          );
        });
        setArgs((prev) => {
          return Array.from(
            { length: data.params.length },
            (_, i) => prev[i] ?? "",
          );
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError("Failed to fetch function ABI");
        setAbi(null);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [moduleAddress, moduleName, functionName, network],
  );

  // retryToken is included so the Retry button can force a re-run while
  // still going through the same debounce + abort machinery.
  // biome-ignore lint/correctness/useExhaustiveDependencies: retryToken is intentionally a re-run trigger, not read inside the effect.
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      fetchAbi(controller.signal).catch(console.error);
    }, 500);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [fetchAbi, retryToken]);

  // Notify parent when values change
  useEffect(() => {
    onChange({ typeArgs, args, abi });
  }, [typeArgs, args, abi, onChange]);

  function updateTypeArg(index: number, value: string) {
    setTypeArgs((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function updateArg(index: number, value: string) {
    setArgs((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">Loading function ABI...</p>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="space-y-2">
          <p>{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRetryToken((t) => t + 1)}
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!abi) return null;

  if (!abi.isEntry) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          This function is not an entry function and cannot be called in a
          transaction.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* Function info */}
      <div className="flex items-center gap-2 text-sm">
        <code className="font-medium">
          {abi.module}::{abi.function}
        </code>
        <Badge variant="outline" className="text-[10px]">
          {abi.visibility}
        </Badge>
        {abi.isEntry && (
          <Badge variant="secondary" className="text-[10px]">
            entry
          </Badge>
        )}
      </div>

      {/* Type arguments */}
      {abi.genericTypeParams > 0 && (
        <div className="space-y-3">
          <Label className="text-sm font-medium">Type Arguments</Label>
          {Array.from({ length: abi.genericTypeParams }, (_, i) => (
            <div key={`type-${i}`} className="space-y-1">
              <Label className="text-xs text-muted-foreground">T{i}</Label>
              <Input
                placeholder="0x1::aptos_coin::AptosCoin"
                value={typeArgs[i] ?? ""}
                onChange={(e) => updateTypeArg(i, e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          ))}
        </div>
      )}

      {/* Function arguments */}
      {abi.params.length > 0 && (
        <div className="space-y-3">
          <Label className="text-sm font-medium">Arguments</Label>
          {abi.params.map((param, i) => {
            const { label, placeholder } = typeLabel(param);
            const innerType = vectorInnerType(param);
            return (
              <div key={`arg-${i}`} className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {label}{" "}
                  <code className="text-[10px] text-muted-foreground/60">
                    {param}
                  </code>
                </Label>
                {innerType !== null ? (
                  <VectorInput
                    innerType={innerType}
                    value={args[i] ?? ""}
                    onChange={(next) => updateArg(i, next)}
                  />
                ) : (
                  <Input
                    placeholder={placeholder}
                    value={args[i] ?? ""}
                    onChange={(e) => updateArg(i, e.target.value)}
                    className="font-mono text-xs"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {abi.params.length === 0 && abi.genericTypeParams === 0 && (
        <p className="text-sm text-muted-foreground">
          This function takes no arguments.
        </p>
      )}
    </div>
  );
}
