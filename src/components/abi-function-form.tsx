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
  if (t === "vector<u8>")
    return { label: "Bytes (hex)", placeholder: "0x..." };
  if (t.startsWith("vector<"))
    return {
      label: `Vector<${t.slice(7, -1)}>`,
      placeholder: "Comma-separated values",
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

  // Fetch ABI when function changes
  const fetchAbi = useCallback(async () => {
    if (!moduleAddress || !moduleName || !functionName) {
      setAbi(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const module = `${moduleAddress}::${moduleName}`;
      const res = await fetch(
        `/api/multisig/abi?module=${encodeURIComponent(module)}&function=${encodeURIComponent(functionName)}&network=${network}`,
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
        const next = Array.from(
          { length: data.genericTypeParams },
          (_, i) => prev[i] ?? "",
        );
        return next;
      });
      setArgs((prev) => {
        const next = Array.from(
          { length: data.params.length },
          (_, i) => prev[i] ?? "",
        );
        return next;
      });
    } catch {
      setError("Failed to fetch function ABI");
      setAbi(null);
    } finally {
      setLoading(false);
    }
  }, [moduleAddress, moduleName, functionName, network]);

  useEffect(() => {
    fetchAbi();
  }, [fetchAbi]);

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
          <Button variant="outline" size="sm" onClick={fetchAbi}>
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
              <Label className="text-xs text-muted-foreground">
                T{i}
              </Label>
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
            return (
              <div key={`arg-${i}`} className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {label}{" "}
                  <code className="text-[10px] text-muted-foreground/60">
                    {param}
                  </code>
                </Label>
                <Input
                  placeholder={placeholder}
                  value={args[i] ?? ""}
                  onChange={(e) => updateArg(i, e.target.value)}
                  className="font-mono text-xs"
                />
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
