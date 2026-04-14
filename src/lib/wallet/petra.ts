import type { PetraWallet } from "./types";

export function getPetraWallet(): PetraWallet | null {
  if (typeof window === "undefined") return null;
  return window.aptos ?? null;
}

export function isPetraInstalled(): boolean {
  return typeof window !== "undefined" && !!window.aptos;
}
