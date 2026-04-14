# Aptos Offchain MultiEd25519 Multisig UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js web app that enables teams to create K-of-N MultiEd25519 multisig accounts on Aptos, propose arbitrary transactions (manually or via dApp iframe proxy), collect Ed25519 signatures offchain via shareable links, and submit combined multi-signed transactions — with optional gas station sponsorship.

**Architecture:** Next.js App Router with API routes for a lightweight backend. SQLite/Turso via Drizzle ORM for persistence. Petra wallet only via `window.aptos`. Signature collection via shareable URLs. dApp interaction via iframe with injected AIP-62 wallet adapter.

**Tech Stack:** Next.js 15, TypeScript, @aptos-labs/ts-sdk, Drizzle ORM, better-sqlite3 (dev) / @libsql/client (prod), Tailwind CSS, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-04-14-aptos-offchain-multisig-design.md`

---

## Phase 1: Foundation

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.js`
- Create: `app/layout.tsx`, `app/page.tsx`, `app/globals.css`
- Create: `components.json` (shadcn config)
- Create: `.env.local`

- [ ] **Step 1: Initialize Next.js project**

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*" --turbopack
```

This creates the full Next.js scaffold with App Router, TypeScript, Tailwind, and ESLint. The `--src-dir=false` puts `app/` at the root.

- [ ] **Step 2: Initialize shadcn/ui**

```bash
npx shadcn@latest init -d
```

This sets up `components.json`, updates `tailwind.config.ts` with shadcn paths, and creates `lib/utils.ts`.

- [ ] **Step 3: Install shadcn components we'll need**

```bash
npx shadcn@latest add button card dialog form input label select textarea badge tabs toast separator alert dropdown-menu
```

- [ ] **Step 4: Install Aptos and database dependencies**

```bash
npm install @aptos-labs/ts-sdk drizzle-orm better-sqlite3 @libsql/client uuid jose
npm install -D drizzle-kit @types/better-sqlite3 @types/uuid
```

- `@aptos-labs/ts-sdk` — Aptos blockchain SDK
- `drizzle-orm` + `better-sqlite3` — database (dev)
- `@libsql/client` — Turso client (prod)
- `uuid` — proposal IDs
- `jose` — JWT for session tokens after signature challenge

- [ ] **Step 5: Create environment file**

Create `.env.local`:
```bash
# Database
DATABASE_URL=file:local.db

# Gas Station (optional)
GAS_STATION_ENABLED=false
GAS_STATION_PRIVATE_KEY=
GAS_STATION_MAX_GAS_PER_TX=10000
GAS_STATION_NETWORKS=devnet,testnet

# Session
JWT_SECRET=dev-secret-change-in-production
```

- [ ] **Step 6: Verify the app starts**

```bash
npm run dev
```

Expected: Next.js dev server starts on localhost:3000 with the default page.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js project with shadcn/ui and Aptos dependencies"
```

---

### Task 2: Database Schema & ORM Setup

**Files:**
- Create: `lib/db/index.ts`
- Create: `lib/db/schema.ts`
- Create: `drizzle.config.ts`

- [ ] **Step 1: Write the schema**

Create `lib/db/schema.ts`:
```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const multisigs = sqliteTable("multisigs", {
  id: text("id").primaryKey(), // UUID
  address: text("address").notNull(),
  publicKeys: text("public_keys").notNull(), // JSON array of hex strings
  threshold: integer("threshold").notNull(),
  network: text("network").notNull(), // "mainnet" | "testnet" | "devnet"
  label: text("label"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const proposals = sqliteTable("proposals", {
  id: text("id").primaryKey(), // UUID, used in shareable URL
  multisigId: text("multisig_id")
    .notNull()
    .references(() => multisigs.id),
  description: text("description").notNull(),
  source: text("source").notNull(), // "manual" | "dapp"
  sourceDappUrl: text("source_dapp_url"),
  payload: text("payload").notNull(), // JSON: { module, function, type_args, args }
  rawTransactionBytes: text("raw_transaction_bytes").notNull(), // hex
  sequenceNumber: integer("sequence_number").notNull(),
  maxGasAmount: integer("max_gas_amount").notNull(),
  gasUnitPrice: integer("gas_unit_price").notNull(),
  expirationTimestampSecs: integer("expiration_timestamp_secs").notNull(),
  feePayerAddress: text("fee_payer_address"),
  feePayerSignature: text("fee_payer_signature"),
  status: text("status").notNull().default("pending"), // pending|ready|submitted|expired|failed
  txHash: text("tx_hash"),
  createdBy: text("created_by").notNull(), // public key hex of proposer
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const signerResponses = sqliteTable("signer_responses", {
  id: text("id").primaryKey(), // UUID
  proposalId: text("proposal_id")
    .notNull()
    .references(() => proposals.id),
  signerIndex: integer("signer_index").notNull(),
  publicKey: text("public_key").notNull(), // hex
  response: text("response").notNull(), // "signed" | "declined"
  signature: text("signature"), // hex, null if declined
  declineReason: text("decline_reason"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
```

- [ ] **Step 2: Create the database connection**

Create `lib/db/index.ts`:
```typescript
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";

const sqlite = new Database(process.env.DATABASE_URL?.replace("file:", "") ?? "local.db");

// Enable WAL mode for better concurrent read performance
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
```

- [ ] **Step 3: Create drizzle config**

Create `drizzle.config.ts`:
```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL?.replace("file:", "") ?? "local.db",
  },
});
```

- [ ] **Step 4: Generate and run the initial migration**

```bash
npx drizzle-kit generate
npx drizzle-kit push
```

Expected: Migration files created in `drizzle/` directory, schema pushed to `local.db`.

- [ ] **Step 5: Verify the database**

```bash
npx drizzle-kit studio
```

Expected: Drizzle Studio opens showing the three tables with correct columns.

- [ ] **Step 6: Commit**

```bash
git add lib/db/ drizzle.config.ts drizzle/
git commit -m "feat: add database schema with Drizzle ORM (multisigs, proposals, signer_responses)"
```

---

### Task 3: Aptos SDK Utilities

**Files:**
- Create: `lib/aptos/client.ts`
- Create: `lib/aptos/multisig.ts`
- Create: `lib/aptos/transaction.ts`
- Test: `lib/aptos/__tests__/multisig.test.ts`

- [ ] **Step 1: Write failing tests for MultiEd25519 address derivation**

Create `lib/aptos/__tests__/multisig.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { deriveMultisigAddress, combineSignatures } from "../multisig";
import {
  Ed25519PrivateKey,
  MultiEd25519PublicKey,
  MultiEd25519Signature,
} from "@aptos-labs/ts-sdk";

describe("deriveMultisigAddress", () => {
  it("derives a deterministic address from public keys and threshold", () => {
    // Generate 3 test key pairs
    const privKey1 = Ed25519PrivateKey.generate();
    const privKey2 = Ed25519PrivateKey.generate();
    const privKey3 = Ed25519PrivateKey.generate();

    const pubKeys = [
      privKey1.publicKey().toString(),
      privKey2.publicKey().toString(),
      privKey3.publicKey().toString(),
    ];

    const result = deriveMultisigAddress(pubKeys, 2);

    expect(result.address).toBeDefined();
    expect(result.address).toMatch(/^0x[a-f0-9]{64}$/);

    // Same inputs should produce same address
    const result2 = deriveMultisigAddress(pubKeys, 2);
    expect(result2.address).toBe(result.address);

    // Different threshold should produce different address
    const result3 = deriveMultisigAddress(pubKeys, 3);
    expect(result3.address).not.toBe(result.address);
  });

  it("rejects invalid inputs", () => {
    const pubKeys = ["0xabc"]; // Only 1 key
    expect(() => deriveMultisigAddress(pubKeys, 2)).toThrow();
  });
});

describe("combineSignatures", () => {
  it("creates a MultiEd25519Signature from individual signatures", () => {
    const privKey1 = Ed25519PrivateKey.generate();
    const privKey2 = Ed25519PrivateKey.generate();
    const privKey3 = Ed25519PrivateKey.generate();

    // Sign a test message
    const message = new Uint8Array([1, 2, 3, 4]);
    const sig1 = privKey1.sign(message);
    const sig3 = privKey3.sign(message);

    const result = combineSignatures([
      { signerIndex: 0, signature: sig1.toString() },
      { signerIndex: 2, signature: sig3.toString() },
    ]);

    expect(result).toBeInstanceOf(MultiEd25519Signature);
  });
});
```

- [ ] **Step 2: Install vitest and run test to verify it fails**

```bash
npm install -D vitest @vitejs/plugin-react
```

Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`

Create `vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

Run: `npm test`
Expected: FAIL — module `../multisig` not found.

- [ ] **Step 3: Create the Aptos client utility**

Create `lib/aptos/client.ts`:
```typescript
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

export type AptosNetwork = "mainnet" | "testnet" | "devnet";

const networkMap: Record<AptosNetwork, Network> = {
  mainnet: Network.MAINNET,
  testnet: Network.TESTNET,
  devnet: Network.DEVNET,
};

const clients: Partial<Record<AptosNetwork, Aptos>> = {};

export function getAptosClient(network: AptosNetwork): Aptos {
  if (!clients[network]) {
    const config = new AptosConfig({ network: networkMap[network] });
    clients[network] = new Aptos(config);
  }
  return clients[network]!;
}
```

- [ ] **Step 4: Implement multisig utilities**

Create `lib/aptos/multisig.ts`:
```typescript
import {
  Ed25519PublicKey,
  Ed25519Signature,
  MultiEd25519PublicKey,
  MultiEd25519Signature,
  AuthenticationKey,
} from "@aptos-labs/ts-sdk";

export interface MultisigAddress {
  address: string;
  multiPublicKey: MultiEd25519PublicKey;
}

/**
 * Derives a MultiEd25519 account address from ordered public keys and threshold.
 * The address is: sha3-256(pk_0 | pk_1 | ... | pk_n | K | 0x01)
 */
export function deriveMultisigAddress(
  publicKeyHexes: string[],
  threshold: number
): MultisigAddress {
  if (threshold > publicKeyHexes.length) {
    throw new Error(
      `Threshold ${threshold} exceeds number of keys ${publicKeyHexes.length}`
    );
  }
  if (threshold < 1) {
    throw new Error("Threshold must be at least 1");
  }
  if (publicKeyHexes.length > 32) {
    throw new Error("Maximum 32 public keys supported");
  }

  const publicKeys = publicKeyHexes.map((hex) => new Ed25519PublicKey(hex));
  const multiPublicKey = new MultiEd25519PublicKey({ publicKeys, threshold });
  const authKey = AuthenticationKey.fromPublicKey({ publicKey: multiPublicKey });
  const address = authKey.derivedAddress().toString();

  return { address, multiPublicKey };
}

export interface SignatureWithIndex {
  signerIndex: number;
  signature: string; // hex
}

/**
 * Combines individual Ed25519 signatures into a MultiEd25519Signature.
 * Signatures must be provided with their signer index (position in the pub key array).
 */
export function combineSignatures(
  signatures: SignatureWithIndex[]
): MultiEd25519Signature {
  // Sort by signer index (required for bitmap)
  const sorted = [...signatures].sort((a, b) => a.signerIndex - b.signerIndex);

  const ed25519Sigs = sorted.map(
    (s) => new Ed25519Signature(s.signature)
  );
  const bitmap = MultiEd25519Signature.createBitmap({
    bits: sorted.map((s) => s.signerIndex),
  });

  return new MultiEd25519Signature({ signatures: ed25519Sigs, bitmap });
}

/**
 * Finds the signer index for a given public key in the multisig's key list.
 * Returns -1 if not found.
 */
export function findSignerIndex(
  publicKeyHexes: string[],
  signerPublicKeyHex: string
): number {
  const normalized = signerPublicKeyHex.toLowerCase().replace(/^0x/, "");
  return publicKeyHexes.findIndex(
    (pk) => pk.toLowerCase().replace(/^0x/, "") === normalized
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 6: Create transaction utilities**

Create `lib/aptos/transaction.ts`:
```typescript
import {
  AccountAddress,
  AccountAuthenticatorMultiEd25519,
  Aptos,
  EntryFunctionABI,
  generateSigningMessageForTransaction,
  generateRawTransaction,
  MultiEd25519PublicKey,
  MultiEd25519Signature,
  RawTransaction,
  Deserializer,
  Serializer,
  SignedTransaction,
  TransactionPayloadEntryFunction,
  EntryFunction,
  SimpleTransaction,
} from "@aptos-labs/ts-sdk";
import { getAptosClient, AptosNetwork } from "./client";

export interface EntryFunctionPayload {
  module: string; // e.g. "0x1::aptos_account"
  function: string; // e.g. "transfer"
  typeArgs: string[];
  args: string[]; // serialized args
}

export interface TransactionConfig {
  multisigAddress: string;
  payload: EntryFunctionPayload;
  maxGasAmount?: number;
  gasUnitPrice?: number;
  expirationSeconds?: number; // seconds from now, default 86400 (24h)
  feePayerAddress?: string;
  network: AptosNetwork;
}

export interface BuiltTransaction {
  rawTransactionBytes: string; // hex
  sequenceNumber: number;
  maxGasAmount: number;
  gasUnitPrice: number;
  expirationTimestampSecs: number;
  signingMessage: Uint8Array; // the bytes each signer must sign
}

/**
 * Builds a RawTransaction for the multisig account.
 * Returns the BCS-serialized bytes and the signing message.
 */
export async function buildTransaction(
  config: TransactionConfig
): Promise<BuiltTransaction> {
  const aptos = getAptosClient(config.network);
  const senderAddress = AccountAddress.from(config.multisigAddress);

  const expirationSeconds = config.expirationSeconds ?? 86400;
  const maxGasAmount = config.maxGasAmount ?? 10000;
  const gasUnitPrice = config.gasUnitPrice ?? 100;

  // Build the transaction via the SDK
  const transaction = await aptos.transaction.build.simple({
    sender: senderAddress,
    data: {
      function: `${config.payload.module}::${config.payload.function}`,
      typeArguments: config.payload.typeArgs,
      functionArguments: config.payload.args,
    },
    options: {
      maxGasAmount,
      gasUnitPrice,
      expireTimestamp: Math.floor(Date.now() / 1000) + expirationSeconds,
    },
    withFeePayer: config.feePayerAddress ? true : undefined,
  });

  // Get the raw transaction and serialize
  const rawTxn = transaction.rawTransaction;
  const serializer = new Serializer();
  rawTxn.serialize(serializer);
  const rawTransactionBytes = Buffer.from(serializer.toUint8Array()).toString("hex");

  // Get the signing message (what signers actually sign)
  const signingMessage = generateSigningMessageForTransaction(transaction);

  return {
    rawTransactionBytes,
    sequenceNumber: Number(rawTxn.sequence_number),
    maxGasAmount: Number(rawTxn.max_gas_amount),
    gasUnitPrice: Number(rawTxn.gas_unit_price),
    expirationTimestampSecs: Number(rawTxn.expiration_timestamp_secs),
    signingMessage,
  };
}

/**
 * Deserializes a hex-encoded RawTransaction.
 */
export function deserializeRawTransaction(hex: string): RawTransaction {
  const bytes = Uint8Array.from(Buffer.from(hex, "hex"));
  const deserializer = new Deserializer(bytes);
  return RawTransaction.deserialize(deserializer);
}

/**
 * Submits a fully-signed MultiEd25519 transaction to the network.
 */
export async function submitMultisigTransaction(params: {
  rawTransactionBytes: string;
  multiPublicKey: MultiEd25519PublicKey;
  multiSignature: MultiEd25519Signature;
  network: AptosNetwork;
  feePayerAddress?: string;
  feePayerSignature?: string;
}): Promise<string> {
  const aptos = getAptosClient(params.network);
  const rawTxn = deserializeRawTransaction(params.rawTransactionBytes);

  const authenticator = new AccountAuthenticatorMultiEd25519(
    params.multiPublicKey,
    params.multiSignature
  );

  const signedTxn = new SignedTransaction(rawTxn, authenticator);
  const response = await aptos.transaction.submit.simple({
    transaction: signedTxn,
    senderAuthenticator: authenticator,
  });

  // Wait for confirmation
  const result = await aptos.waitForTransaction({
    transactionHash: response.hash,
  });

  if (!result.success) {
    throw new Error(`Transaction failed: ${result.vm_status}`);
  }

  return response.hash;
}
```

- [ ] **Step 7: Commit**

```bash
git add lib/aptos/ vitest.config.ts
git commit -m "feat: add Aptos SDK utilities (multisig address derivation, signature combining, transaction building)"
```

---

### Task 4: Wallet Connection & Signature Challenge

**Files:**
- Create: `lib/wallet/petra.ts`
- Create: `lib/wallet/types.ts`
- Create: `lib/auth/session.ts`
- Create: `app/api/verify/route.ts`
- Create: `components/wallet-provider.tsx`
- Create: `components/connect-wallet-button.tsx`

- [ ] **Step 1: Define wallet types**

Create `lib/wallet/types.ts`:
```typescript
export interface PetraWallet {
  connect(): Promise<{ address: string; publicKey: string }>;
  disconnect(): Promise<void>;
  account(): Promise<{ address: string; publicKey: string }>;
  network(): Promise<{ name: string; chainId: string }>;
  signMessage(payload: SignMessagePayload): Promise<SignMessageResponse>;
  signTransaction(payload: unknown): Promise<{ signature: string }>;
  signAndSubmitTransaction(
    payload: unknown
  ): Promise<{ hash: string }>;
  onAccountChange(
    callback: (account: { address: string; publicKey: string }) => void
  ): void;
  onNetworkChange(
    callback: (network: { name: string; chainId: string }) => void
  ): void;
}

export interface SignMessagePayload {
  message: string;
  nonce: string;
  address?: boolean;
  application?: boolean;
  chainId?: boolean;
}

export interface SignMessageResponse {
  signature: string;
  fullMessage: string;
  message: string;
  nonce: string;
  prefix: string;
  address?: string;
  application?: string;
  chainId?: number;
}

declare global {
  interface Window {
    aptos?: PetraWallet;
  }
}
```

- [ ] **Step 2: Create Petra wallet helper**

Create `lib/wallet/petra.ts`:
```typescript
import type { PetraWallet } from "./types";

export function getPetraWallet(): PetraWallet | null {
  if (typeof window === "undefined") return null;
  return window.aptos ?? null;
}

export function isPetraInstalled(): boolean {
  return typeof window !== "undefined" && !!window.aptos;
}
```

- [ ] **Step 3: Create JWT session utilities**

Create `lib/auth/session.ts`:
```typescript
import { SignJWT, jwtVerify } from "jose";

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "dev-secret"
);

export interface SessionPayload {
  publicKey: string;
  address: string;
  network: string;
}

export async function createSessionToken(
  payload: SessionPayload
): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .setIssuedAt()
    .sign(secret);
}

export async function verifySessionToken(
  token: string
): Promise<SessionPayload> {
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as SessionPayload;
}
```

- [ ] **Step 4: Create the verify API route**

Create `app/api/verify/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { Ed25519PublicKey, Ed25519Signature } from "@aptos-labs/ts-sdk";
import { createSessionToken } from "@/lib/auth/session";

// Simple in-memory nonce store (replace with Redis/DB in production)
const usedNonces = new Set<string>();

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { publicKey, signature, fullMessage, nonce, address, network } = body;

  // Check nonce hasn't been used
  if (usedNonces.has(nonce)) {
    return NextResponse.json({ error: "Nonce already used" }, { status: 400 });
  }

  // Verify the message contains our expected prefix
  if (!fullMessage.includes("Aptos Multisig Verification")) {
    return NextResponse.json(
      { error: "Invalid message format" },
      { status: 400 }
    );
  }

  // Verify the Ed25519 signature
  try {
    const pubKey = new Ed25519PublicKey(publicKey);
    const sig = new Ed25519Signature(signature);
    const messageBytes = new TextEncoder().encode(fullMessage);
    const isValid = pubKey.verifySignature({
      message: messageBytes,
      signature: sig,
    });

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Signature verification failed" },
      { status: 401 }
    );
  }

  // Mark nonce as used
  usedNonces.add(nonce);

  // Create session token
  const token = await createSessionToken({ publicKey, address, network });

  return NextResponse.json({ token });
}
```

- [ ] **Step 5: Create wallet provider context**

Create `components/wallet-provider.tsx`:
```typescript
"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { getPetraWallet, isPetraInstalled } from "@/lib/wallet/petra";
import type { AptosNetwork } from "@/lib/aptos/client";

interface WalletState {
  connected: boolean;
  address: string | null;
  publicKey: string | null;
  network: AptosNetwork | null;
  sessionToken: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  verifyIdentity: () => Promise<string>; // returns session token
  isPetraInstalled: boolean;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [network, setNetwork] = useState<AptosNetwork | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    setInstalled(isPetraInstalled());
  }, []);

  const connect = useCallback(async () => {
    const wallet = getPetraWallet();
    if (!wallet) throw new Error("Petra wallet not installed");

    const account = await wallet.connect();
    const net = await wallet.network();

    setConnected(true);
    setAddress(account.address);
    setPublicKey(account.publicKey);
    setNetwork(net.name.toLowerCase() as AptosNetwork);

    // Listen for account/network changes
    wallet.onAccountChange((newAccount) => {
      setAddress(newAccount.address);
      setPublicKey(newAccount.publicKey);
      setSessionToken(null); // invalidate session on account change
    });
    wallet.onNetworkChange((newNet) => {
      setNetwork(newNet.name.toLowerCase() as AptosNetwork);
      setSessionToken(null);
    });
  }, []);

  const disconnect = useCallback(async () => {
    const wallet = getPetraWallet();
    if (wallet) await wallet.disconnect();
    setConnected(false);
    setAddress(null);
    setPublicKey(null);
    setNetwork(null);
    setSessionToken(null);
  }, []);

  const verifyIdentity = useCallback(async (): Promise<string> => {
    if (sessionToken) return sessionToken;

    const wallet = getPetraWallet();
    if (!wallet || !publicKey || !address || !network) {
      throw new Error("Wallet not connected");
    }

    const nonce = crypto.randomUUID();
    const response = await wallet.signMessage({
      message: `Aptos Multisig Verification\nTimestamp: ${Date.now()}`,
      nonce,
      address: true,
      chainId: true,
    });

    const verifyResponse = await fetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey,
        signature: response.signature,
        fullMessage: response.fullMessage,
        nonce,
        address,
        network,
      }),
    });

    if (!verifyResponse.ok) {
      const err = await verifyResponse.json();
      throw new Error(err.error ?? "Verification failed");
    }

    const { token } = await verifyResponse.json();
    setSessionToken(token);
    return token;
  }, [sessionToken, publicKey, address, network]);

  return (
    <WalletContext.Provider
      value={{
        connected,
        address,
        publicKey,
        network,
        sessionToken,
        connect,
        disconnect,
        verifyIdentity,
        isPetraInstalled: installed,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used within WalletProvider");
  return context;
}
```

- [ ] **Step 6: Create connect wallet button**

Create `components/connect-wallet-button.tsx`:
```typescript
"use client";

import { Button } from "@/components/ui/button";
import { useWallet } from "@/components/wallet-provider";

export function ConnectWalletButton() {
  const { connected, address, connect, disconnect, isPetraInstalled } =
    useWallet();

  if (!isPetraInstalled) {
    return (
      <Button variant="outline" asChild>
        <a href="https://petra.app" target="_blank" rel="noopener noreferrer">
          Install Petra Wallet
        </a>
      </Button>
    );
  }

  if (connected && address) {
    return (
      <Button variant="outline" onClick={disconnect}>
        {address.slice(0, 6)}...{address.slice(-4)}
      </Button>
    );
  }

  return <Button onClick={connect}>Connect Wallet</Button>;
}
```

- [ ] **Step 7: Wire into root layout**

Update `app/layout.tsx` to wrap with `WalletProvider` and add the connect button to a header:
```typescript
import { WalletProvider } from "@/components/wallet-provider";
import { ConnectWalletButton } from "@/components/connect-wallet-button";

// In the layout body:
<WalletProvider>
  <header className="flex items-center justify-between p-4 border-b">
    <h1 className="text-lg font-semibold">Aptos Multisig</h1>
    <ConnectWalletButton />
  </header>
  <main className="p-4">{children}</main>
</WalletProvider>
```

- [ ] **Step 8: Commit**

```bash
git add lib/wallet/ lib/auth/ app/api/verify/ components/wallet-provider.tsx components/connect-wallet-button.tsx app/layout.tsx
git commit -m "feat: add Petra wallet connection with signature challenge verification"
```

---

## Phase 2: Multisig Management

### Task 5: Multisig Registration API

**Files:**
- Create: `app/api/multisig/route.ts`
- Create: `app/api/multisig/[address]/route.ts`

- [ ] **Step 1: Create POST /api/multisig (register a multisig)**

Create `app/api/multisig/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { db } from "@/lib/db";
import { multisigs } from "@/lib/db/schema";
import { deriveMultisigAddress } from "@/lib/aptos/multisig";
import { eq, and } from "drizzle-orm";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { publicKeys, threshold, network, label, expectedAddress } = body;

  // Validate inputs
  if (
    !Array.isArray(publicKeys) ||
    publicKeys.length < 2 ||
    publicKeys.length > 32
  ) {
    return NextResponse.json(
      { error: "Need 2-32 public keys" },
      { status: 400 }
    );
  }
  if (threshold < 1 || threshold > publicKeys.length) {
    return NextResponse.json(
      { error: `Threshold must be 1-${publicKeys.length}` },
      { status: 400 }
    );
  }
  if (!["mainnet", "testnet", "devnet"].includes(network)) {
    return NextResponse.json({ error: "Invalid network" }, { status: 400 });
  }

  // Derive address
  const { address } = deriveMultisigAddress(publicKeys, threshold);

  // If expected address provided, verify it matches
  if (expectedAddress && expectedAddress.toLowerCase() !== address.toLowerCase()) {
    return NextResponse.json(
      {
        error: "Address mismatch",
        derived: address,
        expected: expectedAddress,
      },
      { status: 400 }
    );
  }

  // Check if already registered
  const existing = await db.query.multisigs.findFirst({
    where: and(eq(multisigs.address, address), eq(multisigs.network, network)),
  });

  if (existing) {
    return NextResponse.json(existing);
  }

  // Register
  const record = {
    id: uuid(),
    address,
    publicKeys: JSON.stringify(publicKeys),
    threshold,
    network,
    label: label ?? null,
  };

  await db.insert(multisigs).values(record);

  return NextResponse.json(record, { status: 201 });
}
```

- [ ] **Step 2: Create GET /api/multisig/[address]**

Create `app/api/multisig/[address]/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { multisigs } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  const network = request.nextUrl.searchParams.get("network") ?? "mainnet";

  const multisig = await db.query.multisigs.findFirst({
    where: and(
      eq(multisigs.address, address),
      eq(multisigs.network, network)
    ),
  });

  if (!multisig) {
    return NextResponse.json(
      { error: "Multisig not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ...multisig,
    publicKeys: JSON.parse(multisig.publicKeys),
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/multisig/
git commit -m "feat: add multisig registration and lookup API routes"
```

---

### Task 6: Multisig Create & Import Pages

**Files:**
- Create: `app/multisig/create/page.tsx`
- Create: `app/multisig/import/page.tsx`
- Create: `components/multisig-creator.tsx`
- Create: `components/multisig-importer.tsx`

- [ ] **Step 1: Build the multisig creation component**

Create `components/multisig-creator.tsx`:
```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWallet } from "@/components/wallet-provider";
import { deriveMultisigAddress } from "@/lib/aptos/multisig";

export function MultisigCreator() {
  const router = useRouter();
  const { connected, publicKey, network } = useWallet();
  const [publicKeys, setPublicKeys] = useState<string[]>([]);
  const [newKey, setNewKey] = useState("");
  const [threshold, setThreshold] = useState(2);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [derivedAddress, setDerivedAddress] = useState<string | null>(null);

  // Auto-add connected wallet's key
  const allKeys = publicKey
    ? [publicKey, ...publicKeys.filter((k) => k !== publicKey)]
    : publicKeys;

  const addKey = () => {
    if (!newKey.match(/^0x[a-fA-F0-9]{64}$/)) {
      setError("Invalid Ed25519 public key (expected 0x + 64 hex chars)");
      return;
    }
    if (allKeys.includes(newKey)) {
      setError("Key already added");
      return;
    }
    setPublicKeys([...publicKeys, newKey]);
    setNewKey("");
    setError(null);
  };

  const removeKey = (index: number) => {
    setPublicKeys(publicKeys.filter((_, i) => i !== index));
  };

  const preview = () => {
    try {
      const result = deriveMultisigAddress(allKeys, threshold);
      setDerivedAddress(result.address);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const register = async () => {
    const response = await fetch("/api/multisig", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKeys: allKeys,
        threshold,
        network,
        label: label || undefined,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      setError(err.error);
      return;
    }

    const data = await response.json();
    router.push(`/multisig/${data.address}?network=${network}`);
  };

  if (!connected) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p>Connect your Petra wallet to start creating a multisig.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create Multisig</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Your Public Key (auto-added from Petra)</Label>
          <Input value={publicKey ?? ""} disabled className="font-mono text-xs" />
        </div>

        <div>
          <Label>Add Co-Signer Public Keys</Label>
          <div className="flex gap-2">
            <Input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="0x..."
              className="font-mono text-xs"
            />
            <Button onClick={addKey} variant="secondary">
              Add
            </Button>
          </div>
        </div>

        {publicKeys.length > 0 && (
          <div className="space-y-1">
            {publicKeys.map((key, i) => (
              <div key={i} className="flex items-center gap-2 text-xs font-mono">
                <span className="truncate">{key}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeKey(i)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}

        <div>
          <Label>Threshold (K of {allKeys.length})</Label>
          <Input
            type="number"
            min={1}
            max={allKeys.length}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          />
        </div>

        <div>
          <Label>Label (optional)</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Team Treasury"
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        {derivedAddress && (
          <div className="p-3 bg-muted rounded-md">
            <Label>Derived Multisig Address</Label>
            <p className="font-mono text-xs break-all">{derivedAddress}</p>
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={preview} variant="secondary" disabled={allKeys.length < 2}>
            Preview Address
          </Button>
          <Button onClick={register} disabled={!derivedAddress}>
            Create Multisig
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Build the import component**

Create `components/multisig-importer.tsx`:
```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useWallet } from "@/components/wallet-provider";
import { deriveMultisigAddress } from "@/lib/aptos/multisig";
import { getAptosClient } from "@/lib/aptos/client";
import type { AptosNetwork } from "@/lib/aptos/client";

export function MultisigImporter() {
  const router = useRouter();
  const { network } = useWallet();
  const [keysText, setKeysText] = useState("");
  const [threshold, setThreshold] = useState(2);
  const [expectedAddress, setExpectedAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [derivedAddress, setDerivedAddress] = useState<string | null>(null);

  const validate = async () => {
    setError(null);
    setWarning(null);

    const keys = keysText
      .split("\n")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (keys.length < 2) {
      setError("Need at least 2 public keys (one per line)");
      return;
    }

    try {
      const result = deriveMultisigAddress(keys, threshold);
      setDerivedAddress(result.address);

      // Check against expected address if provided
      if (expectedAddress) {
        if (
          expectedAddress.toLowerCase() !== result.address.toLowerCase()
        ) {
          setError(
            `Address mismatch! Derived: ${result.address}, Expected: ${expectedAddress}`
          );
          return;
        }

        // Check on-chain auth key
        if (network) {
          try {
            const aptos = getAptosClient(network);
            const account = await aptos.getAccountInfo({
              accountAddress: result.address,
            });
            const onChainAuthKey = account.authentication_key;
            // The auth key from the MultiEd25519PublicKey
            const expectedAuthKey = result.address; // auth key == address for new accounts
            if (
              onChainAuthKey &&
              onChainAuthKey.toLowerCase() !== expectedAuthKey.toLowerCase()
            ) {
              setWarning(
                "On-chain auth key differs from derived key. This account may have rotated its authentication key."
              );
            }
          } catch {
            // Account may not exist on-chain yet — that's fine
          }
        }
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const importMultisig = async () => {
    const keys = keysText
      .split("\n")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    const response = await fetch("/api/multisig", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKeys: keys,
        threshold,
        network,
        expectedAddress: expectedAddress || undefined,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      setError(err.error);
      return;
    }

    const data = await response.json();
    router.push(`/multisig/${data.address}?network=${network}`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import Existing Multisig</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Public Keys (one per line, in order)</Label>
          <Textarea
            value={keysText}
            onChange={(e) => setKeysText(e.target.value)}
            placeholder={"0xabc...\n0xdef...\n0x123..."}
            rows={5}
            className="font-mono text-xs"
          />
        </div>

        <div>
          <Label>Threshold</Label>
          <Input
            type="number"
            min={1}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          />
        </div>

        <div>
          <Label>Expected Address (optional — for verification)</Label>
          <Input
            value={expectedAddress}
            onChange={(e) => setExpectedAddress(e.target.value)}
            placeholder="0x..."
            className="font-mono text-xs"
          />
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {warning && (
          <Alert>
            <AlertDescription>{warning}</AlertDescription>
          </Alert>
        )}

        {derivedAddress && !error && (
          <div className="p-3 bg-muted rounded-md">
            <Label>Derived Address</Label>
            <p className="font-mono text-xs break-all">{derivedAddress}</p>
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={validate} variant="secondary">
            Validate
          </Button>
          <Button onClick={importMultisig} disabled={!derivedAddress || !!error}>
            Import
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Create the page shells**

Create `app/multisig/create/page.tsx`:
```typescript
import { MultisigCreator } from "@/components/multisig-creator";

export default function CreateMultisigPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <MultisigCreator />
    </div>
  );
}
```

Create `app/multisig/import/page.tsx`:
```typescript
import { MultisigImporter } from "@/components/multisig-importer";

export default function ImportMultisigPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <MultisigImporter />
    </div>
  );
}
```

- [ ] **Step 4: Update landing page**

Update `app/page.tsx`:
```typescript
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold">Aptos Multisig</h1>
      <p className="text-muted-foreground">
        Manage MultiEd25519 multisig treasury accounts on Aptos.
        Create K-of-N multisigs, propose transactions, collect signatures
        via shareable links.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Create New</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Set up a new multisig with your co-signers.
            </p>
            <Button asChild>
              <Link href="/multisig/create">Create Multisig</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Import Existing</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Import a multisig you already have keys for.
            </p>
            <Button variant="secondary" asChild>
              <Link href="/multisig/import">Import Multisig</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx app/multisig/ components/multisig-creator.tsx components/multisig-importer.tsx
git commit -m "feat: add multisig creation and import pages"
```

---

### Task 7: Multisig Dashboard

**Files:**
- Create: `app/multisig/[address]/page.tsx`
- Create: `app/api/multisig/[address]/proposals/route.ts`
- Create: `components/proposal-list.tsx`
- Create: `components/signer-status-grid.tsx`

- [ ] **Step 1: Create proposals listing API**

Create `app/api/multisig/[address]/proposals/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { multisigs, proposals, signerResponses } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  const network = request.nextUrl.searchParams.get("network") ?? "mainnet";

  const multisig = await db.query.multisigs.findFirst({
    where: and(
      eq(multisigs.address, address),
      eq(multisigs.network, network)
    ),
  });

  if (!multisig) {
    return NextResponse.json({ error: "Multisig not found" }, { status: 404 });
  }

  const proposalsList = await db
    .select()
    .from(proposals)
    .where(eq(proposals.multisigId, multisig.id))
    .orderBy(desc(proposals.createdAt));

  // Fetch signer responses for each proposal
  const enriched = await Promise.all(
    proposalsList.map(async (p) => {
      const responses = await db
        .select()
        .from(signerResponses)
        .where(eq(signerResponses.proposalId, p.id));

      return {
        ...p,
        payload: JSON.parse(p.payload),
        signerResponses: responses,
        signedCount: responses.filter((r) => r.response === "signed").length,
        declinedCount: responses.filter((r) => r.response === "declined")
          .length,
      };
    })
  );

  return NextResponse.json(enriched);
}
```

- [ ] **Step 2: Create signer status grid component**

Create `components/signer-status-grid.tsx`:
```typescript
"use client";

import { Badge } from "@/components/ui/badge";

interface SignerResponse {
  signerIndex: number;
  publicKey: string;
  response: "signed" | "declined";
  declineReason?: string | null;
}

interface SignerStatusGridProps {
  publicKeys: string[];
  responses: SignerResponse[];
  threshold: number;
}

export function SignerStatusGrid({
  publicKeys,
  responses,
  threshold,
}: SignerStatusGridProps) {
  const responseMap = new Map(
    responses.map((r) => [r.signerIndex, r])
  );
  const signedCount = responses.filter((r) => r.response === "signed").length;

  return (
    <div className="space-y-2">
      <div className="text-sm text-muted-foreground">
        Signatures: {signedCount} / {threshold} required
      </div>
      <div className="space-y-1">
        {publicKeys.map((key, index) => {
          const response = responseMap.get(index);
          return (
            <div
              key={index}
              className="flex items-center gap-2 text-xs font-mono"
            >
              <span className="w-8 text-muted-foreground">#{index}</span>
              <span className="truncate flex-1">
                {key.slice(0, 10)}...{key.slice(-8)}
              </span>
              {response?.response === "signed" && (
                <Badge variant="default" className="bg-green-600">
                  Signed
                </Badge>
              )}
              {response?.response === "declined" && (
                <Badge variant="destructive">Declined</Badge>
              )}
              {!response && <Badge variant="secondary">Pending</Badge>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create proposal list component**

Create `components/proposal-list.tsx`:
```typescript
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AptosNetwork } from "@/lib/aptos/client";

interface Proposal {
  id: string;
  description: string;
  status: string;
  sequenceNumber: number;
  expirationTimestampSecs: number;
  payload: { module: string; function: string };
  signedCount: number;
  source: string;
  txHash: string | null;
}

interface ProposalListProps {
  address: string;
  network: AptosNetwork;
  threshold: number;
}

export function ProposalList({
  address,
  network,
  threshold,
}: ProposalListProps) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/multisig/${address}/proposals?network=${network}`)
      .then((r) => r.json())
      .then(setProposals)
      .finally(() => setLoading(false));
  }, [address, network]);

  if (loading) return <p>Loading proposals...</p>;
  if (proposals.length === 0) return <p className="text-muted-foreground">No proposals yet.</p>;

  const now = Math.floor(Date.now() / 1000);

  return (
    <div className="space-y-3">
      {proposals.map((p) => {
        const isExpired = p.expirationTimestampSecs < now && p.status === "pending";
        return (
          <Card key={p.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{p.description}</CardTitle>
                <div className="flex gap-1">
                  <Badge variant={isExpired ? "destructive" : "secondary"}>
                    {isExpired ? "expired" : p.status}
                  </Badge>
                  <Badge variant="outline">seq: {p.sequenceNumber}</Badge>
                  {p.source === "dapp" && (
                    <Badge variant="outline">dApp</Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs font-mono text-muted-foreground mb-2">
                {p.payload.module}::{p.payload.function}
              </p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {p.signedCount} / {threshold} signatures
                </span>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/tx/${p.id}`}>
                    {p.txHash ? "View" : "Open"}
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Create dashboard page**

Create `app/multisig/[address]/page.tsx`:
```typescript
import { db } from "@/lib/db";
import { multisigs } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProposalList } from "@/components/proposal-list";
import type { AptosNetwork } from "@/lib/aptos/client";

interface Props {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ network?: string }>;
}

export default async function MultisigDashboard({ params, searchParams }: Props) {
  const { address } = await params;
  const { network: networkParam } = await searchParams;
  const network = (networkParam ?? "mainnet") as AptosNetwork;

  const multisig = await db.query.multisigs.findFirst({
    where: and(
      eq(multisigs.address, address),
      eq(multisigs.network, network)
    ),
  });

  if (!multisig) notFound();

  const publicKeys: string[] = JSON.parse(multisig.publicKeys);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {multisig.label ?? "Multisig"}
          </h1>
          <p className="text-xs font-mono text-muted-foreground break-all">
            {multisig.address}
          </p>
          <p className="text-sm text-muted-foreground">
            {multisig.threshold}-of-{publicKeys.length} on {multisig.network}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link
              href={`/multisig/${address}/propose?network=${network}`}
            >
              New Proposal
            </Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link href={`/multisig/${address}/dapp?network=${network}`}>
              Open dApp
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Signers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {publicKeys.map((key, i) => (
              <div key={i} className="text-xs font-mono">
                <span className="text-muted-foreground">#{i}: </span>
                {key}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-lg font-semibold mb-3">Proposals</h2>
        <ProposalList
          address={address}
          network={network}
          threshold={multisig.threshold}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add app/multisig/\[address\]/ app/api/multisig/\[address\]/proposals/ components/proposal-list.tsx components/signer-status-grid.tsx
git commit -m "feat: add multisig dashboard with proposal listing and signer status grid"
```

---

## Phase 3: Transaction Flow

### Task 8: Proposal Creation API

**Files:**
- Create: `app/api/multisig/[address]/proposals/route.ts` (add POST handler)
- Create: `app/api/proposal/[id]/route.ts`

- [ ] **Step 1: Add POST handler for proposal creation**

Add to `app/api/multisig/[address]/proposals/route.ts` (the GET handler already exists):
```typescript
import { buildTransaction } from "@/lib/aptos/transaction";
import { verifySessionToken } from "@/lib/auth/session";
import { findSignerIndex } from "@/lib/aptos/multisig";
import { v4 as uuid } from "uuid";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;

  // Verify session
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await verifySessionToken(authHeader.slice(7));

  const body = await request.json();
  const {
    network,
    description,
    payload,
    maxGasAmount,
    gasUnitPrice,
    expirationSeconds,
    feePayerAddress,
    source,
    sourceDappUrl,
    signature, // proposer's Ed25519 signature hex
  } = body;

  // Fetch multisig
  const multisig = await db.query.multisigs.findFirst({
    where: and(
      eq(multisigs.address, address),
      eq(multisigs.network, network)
    ),
  });
  if (!multisig) {
    return NextResponse.json({ error: "Multisig not found" }, { status: 404 });
  }

  const publicKeys: string[] = JSON.parse(multisig.publicKeys);

  // Verify proposer is a signer
  const signerIndex = findSignerIndex(publicKeys, session.publicKey);
  if (signerIndex === -1) {
    return NextResponse.json(
      { error: "You are not a signer on this multisig" },
      { status: 403 }
    );
  }

  // Build the transaction
  const built = await buildTransaction({
    multisigAddress: address,
    payload,
    maxGasAmount,
    gasUnitPrice,
    expirationSeconds,
    feePayerAddress,
    network: network as AptosNetwork,
  });

  // Create proposal
  const proposalId = uuid();
  await db.insert(proposals).values({
    id: proposalId,
    multisigId: multisig.id,
    description,
    source: source ?? "manual",
    sourceDappUrl: sourceDappUrl ?? null,
    payload: JSON.stringify(payload),
    rawTransactionBytes: built.rawTransactionBytes,
    sequenceNumber: built.sequenceNumber,
    maxGasAmount: built.maxGasAmount,
    gasUnitPrice: built.gasUnitPrice,
    expirationTimestampSecs: built.expirationTimestampSecs,
    feePayerAddress: feePayerAddress ?? null,
    status: "pending",
    createdBy: session.publicKey,
  });

  // Store proposer's signature
  if (signature) {
    await db.insert(signerResponses).values({
      id: uuid(),
      proposalId,
      signerIndex,
      publicKey: session.publicKey,
      response: "signed",
      signature,
    });
  }

  return NextResponse.json(
    { id: proposalId, url: `/tx/${proposalId}` },
    { status: 201 }
  );
}
```

- [ ] **Step 2: Create proposal detail API**

Create `app/api/proposal/[id]/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, signerResponses, multisigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const proposal = await db.query.proposals.findFirst({
    where: eq(proposals.id, id),
  });

  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  const multisig = await db.query.multisigs.findFirst({
    where: eq(multisigs.id, proposal.multisigId),
  });

  const responses = await db
    .select()
    .from(signerResponses)
    .where(eq(signerResponses.proposalId, id));

  return NextResponse.json({
    ...proposal,
    payload: JSON.parse(proposal.payload),
    multisig: multisig
      ? {
          ...multisig,
          publicKeys: JSON.parse(multisig.publicKeys),
        }
      : null,
    signerResponses: responses,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/multisig/\[address\]/proposals/ app/api/proposal/
git commit -m "feat: add proposal creation and detail API routes"
```

---

### Task 9: Proposal Creation UI

**Files:**
- Create: `app/multisig/[address]/propose/page.tsx`
- Create: `components/proposal-builder.tsx`

- [ ] **Step 1: Build the proposal builder component**

Create `components/proposal-builder.tsx`:
```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useWallet } from "@/components/wallet-provider";
import type { AptosNetwork } from "@/lib/aptos/client";

interface ProposalBuilderProps {
  multisigAddress: string;
  network: AptosNetwork;
  threshold: number;
  publicKeys: string[];
}

export function ProposalBuilder({
  multisigAddress,
  network,
  threshold,
  publicKeys,
}: ProposalBuilderProps) {
  const router = useRouter();
  const { connected, publicKey, verifyIdentity } = useWallet();
  const [description, setDescription] = useState("");
  const [moduleAddr, setModuleAddr] = useState("");
  const [moduleName, setModuleName] = useState("");
  const [functionName, setFunctionName] = useState("");
  const [typeArgs, setTypeArgs] = useState("");
  const [args, setArgs] = useState("");
  const [maxGas, setMaxGas] = useState("10000");
  const [gasPrice, setGasPrice] = useState("100");
  const [expirationHours, setExpirationHours] = useState("24");
  const [feePayerAddress, setFeePayerAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [proposalUrl, setProposalUrl] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setSubmitting(true);

    try {
      const token = await verifyIdentity();

      const payload = {
        module: `${moduleAddr}::${moduleName}`,
        function: functionName,
        typeArgs: typeArgs
          ? typeArgs.split(",").map((t) => t.trim())
          : [],
        args: args
          ? args.split(",").map((a) => a.trim())
          : [],
      };

      // TODO: Sign the raw transaction bytes with Petra before submitting
      // For now, create the proposal without the proposer's signature
      // and have them sign via the shareable link
      const response = await fetch(
        `/api/multisig/${multisigAddress}/proposals`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            network,
            description,
            payload,
            maxGasAmount: Number(maxGas),
            gasUnitPrice: Number(gasPrice),
            expirationSeconds: Number(expirationHours) * 3600,
            feePayerAddress: feePayerAddress || undefined,
            source: "manual",
          }),
        }
      );

      if (!response.ok) {
        const err = await response.json();
        setError(err.error);
        return;
      }

      const data = await response.json();
      setProposalUrl(`${window.location.origin}/tx/${data.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!connected) {
    return <p>Connect your Petra wallet to create a proposal.</p>;
  }

  if (proposalUrl) {
    return (
      <Card>
        <CardContent className="pt-6 space-y-4">
          <p className="font-semibold">Proposal Created!</p>
          <p className="text-sm">Share this link with co-signers:</p>
          <div className="flex gap-2">
            <Input value={proposalUrl} readOnly className="font-mono text-xs" />
            <Button
              onClick={() => navigator.clipboard.writeText(proposalUrl)}
              variant="secondary"
            >
              Copy
            </Button>
          </div>
          <Button
            onClick={() => router.push(proposalUrl.replace(window.location.origin, ""))}
          >
            Open Proposal
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New Transaction Proposal</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Description</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this transaction do?"
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label>Module Address</Label>
            <Input
              value={moduleAddr}
              onChange={(e) => setModuleAddr(e.target.value)}
              placeholder="0x1"
              className="font-mono text-xs"
            />
          </div>
          <div>
            <Label>Module Name</Label>
            <Input
              value={moduleName}
              onChange={(e) => setModuleName(e.target.value)}
              placeholder="aptos_account"
            />
          </div>
          <div>
            <Label>Function</Label>
            <Input
              value={functionName}
              onChange={(e) => setFunctionName(e.target.value)}
              placeholder="transfer"
            />
          </div>
        </div>

        <div>
          <Label>Type Arguments (comma-separated, optional)</Label>
          <Input
            value={typeArgs}
            onChange={(e) => setTypeArgs(e.target.value)}
            placeholder="0x1::aptos_coin::AptosCoin"
            className="font-mono text-xs"
          />
        </div>

        <div>
          <Label>Function Arguments (comma-separated)</Label>
          <Input
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder="0xrecipient, 1000000"
            className="font-mono text-xs"
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label>Max Gas</Label>
            <Input
              type="number"
              value={maxGas}
              onChange={(e) => setMaxGas(e.target.value)}
            />
          </div>
          <div>
            <Label>Gas Price</Label>
            <Input
              type="number"
              value={gasPrice}
              onChange={(e) => setGasPrice(e.target.value)}
            />
          </div>
          <div>
            <Label>Expires (hours)</Label>
            <Input
              type="number"
              value={expirationHours}
              onChange={(e) => setExpirationHours(e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label>Fee Payer Address (optional — for sponsored gas)</Label>
          <Input
            value={feePayerAddress}
            onChange={(e) => setFeePayerAddress(e.target.value)}
            placeholder="0x... or leave blank for self-pay"
            className="font-mono text-xs"
          />
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button onClick={submit} disabled={submitting || !description}>
          {submitting ? "Creating..." : "Create Proposal"}
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create the propose page**

Create `app/multisig/[address]/propose/page.tsx`:
```typescript
import { db } from "@/lib/db";
import { multisigs } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ProposalBuilder } from "@/components/proposal-builder";
import type { AptosNetwork } from "@/lib/aptos/client";

interface Props {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ network?: string }>;
}

export default async function ProposePage({ params, searchParams }: Props) {
  const { address } = await params;
  const { network: networkParam } = await searchParams;
  const network = (networkParam ?? "mainnet") as AptosNetwork;

  const multisig = await db.query.multisigs.findFirst({
    where: and(
      eq(multisigs.address, address),
      eq(multisigs.network, network)
    ),
  });

  if (!multisig) notFound();

  const publicKeys: string[] = JSON.parse(multisig.publicKeys);

  return (
    <div className="max-w-2xl mx-auto">
      <ProposalBuilder
        multisigAddress={address}
        network={network}
        threshold={multisig.threshold}
        publicKeys={publicKeys}
      />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/multisig/\[address\]/propose/ components/proposal-builder.tsx
git commit -m "feat: add proposal creation UI with entry function builder"
```

---

### Task 10: Signature Collection (Shareable Link)

**Files:**
- Create: `app/tx/[proposalId]/page.tsx`
- Create: `app/api/proposal/[id]/sign/route.ts`
- Create: `app/api/proposal/[id]/decline/route.ts`
- Create: `components/proposal-view.tsx`

- [ ] **Step 1: Create sign and decline API routes**

Create `app/api/proposal/[id]/sign/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { db } from "@/lib/db";
import { proposals, signerResponses, multisigs } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { verifySessionToken } from "@/lib/auth/session";
import { findSignerIndex } from "@/lib/aptos/multisig";
import { Ed25519PublicKey, Ed25519Signature } from "@aptos-labs/ts-sdk";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Verify session
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await verifySessionToken(authHeader.slice(7));

  const body = await request.json();
  const { signature } = body; // hex-encoded Ed25519 signature

  // Fetch proposal and multisig
  const proposal = await db.query.proposals.findFirst({
    where: eq(proposals.id, id),
  });
  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  if (proposal.status !== "pending") {
    return NextResponse.json(
      { error: `Proposal is ${proposal.status}, cannot sign` },
      { status: 400 }
    );
  }

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (proposal.expirationTimestampSecs < now) {
    await db
      .update(proposals)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(proposals.id, id));
    return NextResponse.json({ error: "Proposal has expired" }, { status: 400 });
  }

  const multisig = await db.query.multisigs.findFirst({
    where: eq(multisigs.id, proposal.multisigId),
  });
  if (!multisig) {
    return NextResponse.json({ error: "Multisig not found" }, { status: 500 });
  }

  const publicKeys: string[] = JSON.parse(multisig.publicKeys);
  const signerIndex = findSignerIndex(publicKeys, session.publicKey);
  if (signerIndex === -1) {
    return NextResponse.json(
      { error: "You are not a signer on this multisig" },
      { status: 403 }
    );
  }

  // Check for duplicate
  const existing = await db.query.signerResponses.findFirst({
    where: and(
      eq(signerResponses.proposalId, id),
      eq(signerResponses.signerIndex, signerIndex)
    ),
  });
  if (existing) {
    return NextResponse.json(
      { error: "You have already responded to this proposal" },
      { status: 400 }
    );
  }

  // Validate the signature against the raw transaction bytes
  try {
    const pubKey = new Ed25519PublicKey(session.publicKey);
    const sig = new Ed25519Signature(signature);
    const rawBytes = Uint8Array.from(
      Buffer.from(proposal.rawTransactionBytes, "hex")
    );
    // Note: The actual verification depends on what bytes were signed.
    // For now, store the signature — full verification happens at submission time
    // when we combine and submit to the chain.
  } catch {
    return NextResponse.json(
      { error: "Invalid signature format" },
      { status: 400 }
    );
  }

  // Store the signature
  await db.insert(signerResponses).values({
    id: uuid(),
    proposalId: id,
    signerIndex,
    publicKey: session.publicKey,
    response: "signed",
    signature,
  });

  // Check if threshold is met
  const allResponses = await db
    .select()
    .from(signerResponses)
    .where(eq(signerResponses.proposalId, id));

  const signedCount = allResponses.filter(
    (r) => r.response === "signed"
  ).length;

  if (signedCount >= multisig.threshold) {
    await db
      .update(proposals)
      .set({ status: "ready", updatedAt: new Date() })
      .where(eq(proposals.id, id));
  }

  return NextResponse.json({
    status: signedCount >= multisig.threshold ? "ready" : "pending",
    signedCount,
    threshold: multisig.threshold,
  });
}
```

Create `app/api/proposal/[id]/decline/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { db } from "@/lib/db";
import { proposals, signerResponses, multisigs } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { verifySessionToken } from "@/lib/auth/session";
import { findSignerIndex } from "@/lib/aptos/multisig";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await verifySessionToken(authHeader.slice(7));

  const body = await request.json();
  const { reason } = body;

  const proposal = await db.query.proposals.findFirst({
    where: eq(proposals.id, id),
  });
  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  const multisig = await db.query.multisigs.findFirst({
    where: eq(multisigs.id, proposal.multisigId),
  });
  if (!multisig) {
    return NextResponse.json({ error: "Multisig not found" }, { status: 500 });
  }

  const publicKeys: string[] = JSON.parse(multisig.publicKeys);
  const signerIndex = findSignerIndex(publicKeys, session.publicKey);
  if (signerIndex === -1) {
    return NextResponse.json(
      { error: "You are not a signer" },
      { status: 403 }
    );
  }

  const existing = await db.query.signerResponses.findFirst({
    where: and(
      eq(signerResponses.proposalId, id),
      eq(signerResponses.signerIndex, signerIndex)
    ),
  });
  if (existing) {
    return NextResponse.json(
      { error: "Already responded" },
      { status: 400 }
    );
  }

  await db.insert(signerResponses).values({
    id: uuid(),
    proposalId: id,
    signerIndex,
    publicKey: session.publicKey,
    response: "declined",
    declineReason: reason ?? null,
  });

  return NextResponse.json({ status: "declined" });
}
```

- [ ] **Step 2: Create the proposal view component**

Create `components/proposal-view.tsx`:
```typescript
"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SignerStatusGrid } from "@/components/signer-status-grid";
import { useWallet } from "@/components/wallet-provider";
import { findSignerIndex } from "@/lib/aptos/multisig";
import { getPetraWallet } from "@/lib/wallet/petra";

interface ProposalViewProps {
  proposalId: string;
}

interface ProposalData {
  id: string;
  description: string;
  status: string;
  source: string;
  sourceDappUrl: string | null;
  payload: { module: string; function: string; typeArgs: string[]; args: string[] };
  rawTransactionBytes: string;
  sequenceNumber: number;
  maxGasAmount: number;
  gasUnitPrice: number;
  expirationTimestampSecs: number;
  feePayerAddress: string | null;
  txHash: string | null;
  multisig: {
    address: string;
    publicKeys: string[];
    threshold: number;
    network: string;
  };
  signerResponses: Array<{
    signerIndex: number;
    publicKey: string;
    response: "signed" | "declined";
    declineReason: string | null;
  }>;
}

export function ProposalView({ proposalId }: ProposalViewProps) {
  const { connected, publicKey, network, verifyIdentity } = useWallet();
  const [proposal, setProposal] = useState<ProposalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [showDecline, setShowDecline] = useState(false);
  const [signing, setSigning] = useState(false);

  const fetchProposal = useCallback(async () => {
    const res = await fetch(`/api/proposal/${proposalId}`);
    if (res.ok) {
      setProposal(await res.json());
    }
    setLoading(false);
  }, [proposalId]);

  useEffect(() => {
    fetchProposal();
  }, [fetchProposal]);

  if (loading) return <p>Loading...</p>;
  if (!proposal) return <p>Proposal not found.</p>;

  const now = Math.floor(Date.now() / 1000);
  const isExpired = proposal.expirationTimestampSecs < now;
  const signerIndex = publicKey
    ? findSignerIndex(proposal.multisig.publicKeys, publicKey)
    : -1;
  const isSigner = signerIndex !== -1;
  const hasResponded = proposal.signerResponses.some(
    (r) => r.signerIndex === signerIndex
  );
  const networkMismatch = network !== proposal.multisig.network;
  const signedCount = proposal.signerResponses.filter(
    (r) => r.response === "signed"
  ).length;

  const handleSign = async () => {
    setError(null);
    setSigning(true);

    try {
      const token = await verifyIdentity();
      const wallet = getPetraWallet();
      if (!wallet) throw new Error("Petra not available");

      // Sign the raw transaction bytes
      // Note: The exact signing mechanism depends on how Petra exposes
      // signTransaction for arbitrary bytes. This may need to use signMessage
      // with the transaction's signing message, or the wallet adapter's
      // signTransaction method.
      const rawBytes = proposal.rawTransactionBytes;
      const signResult = await wallet.signMessage({
        message: rawBytes,
        nonce: proposalId,
      });

      const response = await fetch(`/api/proposal/${proposalId}/sign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ signature: signResult.signature }),
      });

      if (!response.ok) {
        const err = await response.json();
        setError(err.error);
        return;
      }

      await fetchProposal();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSigning(false);
    }
  };

  const handleDecline = async () => {
    setError(null);

    try {
      const token = await verifyIdentity();

      const response = await fetch(`/api/proposal/${proposalId}/decline`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: declineReason || undefined }),
      });

      if (!response.ok) {
        const err = await response.json();
        setError(err.error);
        return;
      }

      await fetchProposal();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{proposal.description}</CardTitle>
            <div className="flex gap-1">
              <Badge
                variant={
                  proposal.status === "submitted"
                    ? "default"
                    : isExpired
                      ? "destructive"
                      : "secondary"
                }
              >
                {isExpired && proposal.status === "pending"
                  ? "expired"
                  : proposal.status}
              </Badge>
              {proposal.source === "dapp" && (
                <Badge variant="outline">dApp</Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Transaction details */}
          <div>
            <p className="text-sm font-semibold">Entry Function</p>
            <p className="text-xs font-mono">
              {proposal.payload.module}::{proposal.payload.function}
            </p>
          </div>

          {proposal.payload.typeArgs.length > 0 && (
            <div>
              <p className="text-sm font-semibold">Type Arguments</p>
              {proposal.payload.typeArgs.map((t, i) => (
                <p key={i} className="text-xs font-mono">{t}</p>
              ))}
            </div>
          )}

          {proposal.payload.args.length > 0 && (
            <div>
              <p className="text-sm font-semibold">Arguments</p>
              {proposal.payload.args.map((a, i) => (
                <p key={i} className="text-xs font-mono">{a}</p>
              ))}
            </div>
          )}

          <div className="grid grid-cols-3 gap-4 text-xs">
            <div>
              <span className="text-muted-foreground">Seq #: </span>
              {proposal.sequenceNumber}
            </div>
            <div>
              <span className="text-muted-foreground">Max Gas: </span>
              {proposal.maxGasAmount}
            </div>
            <div>
              <span className="text-muted-foreground">Expires: </span>
              {new Date(proposal.expirationTimestampSecs * 1000).toLocaleString()}
            </div>
          </div>

          {proposal.feePayerAddress && (
            <div className="text-xs">
              <span className="text-muted-foreground">Fee Payer: </span>
              <span className="font-mono">{proposal.feePayerAddress}</span>
            </div>
          )}

          {proposal.txHash && (
            <div className="text-xs">
              <span className="text-muted-foreground">Tx Hash: </span>
              <span className="font-mono">{proposal.txHash}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Signers</CardTitle>
        </CardHeader>
        <CardContent>
          <SignerStatusGrid
            publicKeys={proposal.multisig.publicKeys}
            responses={proposal.signerResponses}
            threshold={proposal.multisig.threshold}
          />
        </CardContent>
      </Card>

      {/* Actions */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {networkMismatch && connected && (
        <Alert>
          <AlertDescription>
            Switch Petra to {proposal.multisig.network} to interact with this
            proposal.
          </AlertDescription>
        </Alert>
      )}

      {connected &&
        isSigner &&
        !hasResponded &&
        !isExpired &&
        !networkMismatch &&
        proposal.status === "pending" && (
          <Card>
            <CardContent className="pt-6 space-y-3">
              <div className="flex gap-2">
                <Button onClick={handleSign} disabled={signing}>
                  {signing ? "Signing..." : "Sign Transaction"}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setShowDecline(!showDecline)}
                >
                  Decline
                </Button>
              </div>

              {showDecline && (
                <div className="space-y-2">
                  <Textarea
                    value={declineReason}
                    onChange={(e) => setDeclineReason(e.target.value)}
                    placeholder="Reason for declining (optional)"
                  />
                  <Button variant="destructive" onClick={handleDecline}>
                    Confirm Decline
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

      {!connected && (
        <p className="text-muted-foreground text-sm">
          Connect your Petra wallet to sign or decline this proposal.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create the shareable link page**

Create `app/tx/[proposalId]/page.tsx`:
```typescript
import { ProposalView } from "@/components/proposal-view";

interface Props {
  params: Promise<{ proposalId: string }>;
}

export default async function ProposalPage({ params }: Props) {
  const { proposalId } = await params;
  return <ProposalView proposalId={proposalId} />;
}
```

- [ ] **Step 4: Commit**

```bash
git add app/tx/ app/api/proposal/\[id\]/sign/ app/api/proposal/\[id\]/decline/ components/proposal-view.tsx
git commit -m "feat: add shareable proposal signing page with sign/decline flow"
```

---

### Task 11: Transaction Submission

**Files:**
- Create: `app/api/proposal/[id]/submit/route.ts`
- Modify: `components/proposal-view.tsx` (add submit button)

- [ ] **Step 1: Create the submit API route**

Create `app/api/proposal/[id]/submit/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, signerResponses, multisigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { deriveMultisigAddress, combineSignatures } from "@/lib/aptos/multisig";
import { submitMultisigTransaction } from "@/lib/aptos/transaction";
import type { AptosNetwork } from "@/lib/aptos/client";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const proposal = await db.query.proposals.findFirst({
    where: eq(proposals.id, id),
  });
  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  if (proposal.status !== "ready") {
    return NextResponse.json(
      { error: `Proposal is ${proposal.status}, expected 'ready'` },
      { status: 400 }
    );
  }

  const multisig = await db.query.multisigs.findFirst({
    where: eq(multisigs.id, proposal.multisigId),
  });
  if (!multisig) {
    return NextResponse.json({ error: "Multisig not found" }, { status: 500 });
  }

  const publicKeys: string[] = JSON.parse(multisig.publicKeys);

  // Get signed responses
  const responses = await db
    .select()
    .from(signerResponses)
    .where(eq(signerResponses.proposalId, id));

  const signatures = responses
    .filter((r) => r.response === "signed" && r.signature)
    .map((r) => ({
      signerIndex: r.signerIndex,
      signature: r.signature!,
    }));

  if (signatures.length < multisig.threshold) {
    return NextResponse.json(
      { error: "Not enough signatures" },
      { status: 400 }
    );
  }

  // Combine signatures
  const multiSignature = combineSignatures(signatures);
  const { multiPublicKey } = deriveMultisigAddress(
    publicKeys,
    multisig.threshold
  );

  try {
    const txHash = await submitMultisigTransaction({
      rawTransactionBytes: proposal.rawTransactionBytes,
      multiPublicKey,
      multiSignature,
      network: multisig.network as AptosNetwork,
      feePayerAddress: proposal.feePayerAddress ?? undefined,
      feePayerSignature: proposal.feePayerSignature ?? undefined,
    });

    await db
      .update(proposals)
      .set({ status: "submitted", txHash, updatedAt: new Date() })
      .where(eq(proposals.id, id));

    return NextResponse.json({ txHash, status: "submitted" });
  } catch (e) {
    await db
      .update(proposals)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(proposals.id, id));

    return NextResponse.json(
      { error: `Submission failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Add submit button to ProposalView**

In `components/proposal-view.tsx`, add a submit handler and button that shows when `proposal.status === "ready"`:

```typescript
// Add this handler inside ProposalView:
const handleSubmit = async () => {
  setError(null);
  setSigning(true);
  try {
    const response = await fetch(`/api/proposal/${proposalId}/submit`, {
      method: "POST",
    });
    if (!response.ok) {
      const err = await response.json();
      setError(err.error);
      return;
    }
    await fetchProposal();
  } catch (e) {
    setError((e as Error).message);
  } finally {
    setSigning(false);
  }
};

// Add this JSX block after the signing actions:
{proposal.status === "ready" && (
  <Card>
    <CardContent className="pt-6">
      <p className="text-sm mb-3">
        Threshold reached ({signedCount}/{proposal.multisig.threshold}).
        Ready to submit.
      </p>
      <Button onClick={handleSubmit} disabled={signing}>
        {signing ? "Submitting..." : "Submit Transaction"}
      </Button>
    </CardContent>
  </Card>
)}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/proposal/\[id\]/submit/ components/proposal-view.tsx
git commit -m "feat: add transaction submission (combine MultiEd25519 signatures + submit to chain)"
```

---

## Phase 4: Gas Station

### Task 12: Fee Payer / Gas Station

**Files:**
- Create: `lib/gas-station/index.ts`
- Create: `app/api/gas-station/sponsor/route.ts`
- Modify: `app/api/proposal/[id]/submit/route.ts` (integrate auto-sponsor)

- [ ] **Step 1: Create gas station utility**

Create `lib/gas-station/index.ts`:
```typescript
import {
  Ed25519PrivateKey,
  Ed25519PublicKey,
  AccountAddress,
} from "@aptos-labs/ts-sdk";
import type { AptosNetwork } from "@/lib/aptos/client";

interface GasStationConfig {
  enabled: boolean;
  privateKey: Ed25519PrivateKey | null;
  address: string | null;
  publicKey: string | null;
  maxGasPerTx: number;
  networks: AptosNetwork[];
}

let config: GasStationConfig | null = null;

export function getGasStationConfig(): GasStationConfig {
  if (config) return config;

  const enabled = process.env.GAS_STATION_ENABLED === "true";
  const keyHex = process.env.GAS_STATION_PRIVATE_KEY;
  const maxGas = Number(process.env.GAS_STATION_MAX_GAS_PER_TX ?? "10000");
  const networks = (process.env.GAS_STATION_NETWORKS ?? "devnet,testnet")
    .split(",")
    .map((n) => n.trim()) as AptosNetwork[];

  let privateKey: Ed25519PrivateKey | null = null;
  let address: string | null = null;
  let publicKey: string | null = null;

  if (enabled && keyHex) {
    privateKey = new Ed25519PrivateKey(keyHex);
    const pubKey = privateKey.publicKey();
    publicKey = pubKey.toString();
    address = AccountAddress.from(pubKey.toString()).toString();
  }

  config = {
    enabled,
    privateKey,
    address,
    publicKey,
    maxGasPerTx: maxGas,
    networks,
  };

  return config;
}

/**
 * Signs raw transaction bytes as the fee payer.
 */
export function signAsFeePlayer(rawTransactionBytes: string): string {
  const cfg = getGasStationConfig();
  if (!cfg.enabled || !cfg.privateKey) {
    throw new Error("Gas station not configured");
  }

  const bytes = Uint8Array.from(Buffer.from(rawTransactionBytes, "hex"));
  const signature = cfg.privateKey.sign(bytes);
  return signature.toString();
}
```

- [ ] **Step 2: Create sponsor API route**

Create `app/api/gas-station/sponsor/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, multisigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getGasStationConfig, signAsFeePlayer } from "@/lib/gas-station";
import type { AptosNetwork } from "@/lib/aptos/client";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { proposalId } = body;

  const cfg = getGasStationConfig();
  if (!cfg.enabled) {
    return NextResponse.json(
      { error: "Gas station is disabled" },
      { status: 400 }
    );
  }

  const proposal = await db.query.proposals.findFirst({
    where: eq(proposals.id, proposalId),
  });
  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  // Verify the fee payer address matches the gas station
  if (
    !proposal.feePayerAddress ||
    proposal.feePayerAddress.toLowerCase() !== cfg.address?.toLowerCase()
  ) {
    return NextResponse.json(
      { error: "Fee payer address does not match gas station" },
      { status: 400 }
    );
  }

  // Check network is supported
  const multisig = await db.query.multisigs.findFirst({
    where: eq(multisigs.id, proposal.multisigId),
  });
  if (!multisig || !cfg.networks.includes(multisig.network as AptosNetwork)) {
    return NextResponse.json(
      { error: "Gas station not enabled for this network" },
      { status: 400 }
    );
  }

  // Check gas cap
  if (proposal.maxGasAmount > cfg.maxGasPerTx) {
    return NextResponse.json(
      { error: `Gas exceeds cap: ${proposal.maxGasAmount} > ${cfg.maxGasPerTx}` },
      { status: 400 }
    );
  }

  // Sign as fee payer
  const feePayerSignature = signAsFeePlayer(proposal.rawTransactionBytes);

  await db
    .update(proposals)
    .set({ feePayerSignature, updatedAt: new Date() })
    .where(eq(proposals.id, proposalId));

  return NextResponse.json({ status: "sponsored", feePayerSignature });
}
```

- [ ] **Step 3: Integrate auto-sponsorship into submit flow**

In `app/api/proposal/[id]/submit/route.ts`, add auto-sponsor logic before submission:

```typescript
// Add at the top of the POST handler, after checking status === "ready":
// Auto-sponsor if gas station is configured and matches
if (proposal.feePayerAddress && !proposal.feePayerSignature) {
  const gasConfig = getGasStationConfig();
  if (
    gasConfig.enabled &&
    gasConfig.address?.toLowerCase() === proposal.feePayerAddress.toLowerCase() &&
    gasConfig.networks.includes(multisig.network as AptosNetwork)
  ) {
    const feePayerSig = signAsFeePlayer(proposal.rawTransactionBytes);
    await db
      .update(proposals)
      .set({ feePayerSignature: feePayerSig, updatedAt: new Date() })
      .where(eq(proposals.id, id));
    proposal.feePayerSignature = feePayerSig;
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add lib/gas-station/ app/api/gas-station/ app/api/proposal/\[id\]/submit/
git commit -m "feat: add gas station with auto-sponsor and manual fee payer support"
```

---

## Phase 5: dApp Proxy

### Task 13: dApp Iframe Proxy Page

**Files:**
- Create: `app/multisig/[address]/dapp/page.tsx`
- Create: `components/dapp-proxy.tsx`
- Create: `components/dapp-tx-confirm-modal.tsx`
- Create: `public/dapp-wallet-inject.js`

- [ ] **Step 1: Create the wallet injection script**

This script gets injected into the dApp iframe. It implements a minimal AIP-62-like wallet that communicates with the parent frame via `postMessage`.

Create `public/dapp-wallet-inject.js`:
```javascript
// This script is injected into the dApp iframe to intercept wallet calls.
// It communicates with the parent multisig UI via postMessage.

(function () {
  const PARENT_ORIGIN = window.location.ancestorOrigins?.[0] || "*";
  let resolvers = {};
  let requestId = 0;

  // Listen for responses from parent
  window.addEventListener("message", (event) => {
    if (event.data?.type === "MULTISIG_WALLET_RESPONSE") {
      const { id, result, error } = event.data;
      const resolver = resolvers[id];
      if (resolver) {
        if (error) {
          resolver.reject(new Error(error));
        } else {
          resolver.resolve(result);
        }
        delete resolvers[id];
      }
    }
  });

  function sendToParent(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      resolvers[id] = { resolve, reject };
      window.parent.postMessage(
        {
          type: "MULTISIG_WALLET_REQUEST",
          id,
          method,
          params,
        },
        PARENT_ORIGIN
      );
    });
  }

  // Override window.aptos with our multisig wallet proxy
  window.aptos = {
    connect: () => sendToParent("connect", {}),
    disconnect: () => sendToParent("disconnect", {}),
    account: () => sendToParent("account", {}),
    network: () => sendToParent("network", {}),
    signMessage: (payload) => sendToParent("signMessage", payload),
    signTransaction: (payload) => sendToParent("signTransaction", payload),
    signAndSubmitTransaction: (payload) =>
      sendToParent("signAndSubmitTransaction", payload),
    onAccountChange: () => {},
    onNetworkChange: () => {},
    isConnected: () => sendToParent("isConnected", {}),
  };

  // Dispatch wallet-ready event for dApps using AIP-62 discovery
  window.dispatchEvent(new Event("aptos:wallet:ready"));
})();
```

- [ ] **Step 2: Create the transaction confirmation modal**

Create `components/dapp-tx-confirm-modal.tsx`:
```typescript
"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

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
  if (!payload) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transaction Request from dApp</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Source: {dappUrl}
          </div>

          <div>
            <p className="text-sm font-semibold">Function</p>
            <p className="text-xs font-mono">{payload.function}</p>
          </div>

          {payload.type_arguments.length > 0 && (
            <div>
              <p className="text-sm font-semibold">Type Arguments</p>
              {payload.type_arguments.map((t, i) => (
                <p key={i} className="text-xs font-mono">{t}</p>
              ))}
            </div>
          )}

          {payload.arguments.length > 0 && (
            <div>
              <p className="text-sm font-semibold">Arguments</p>
              {payload.arguments.map((a, i) => (
                <p key={i} className="text-xs font-mono">{a}</p>
              ))}
            </div>
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
```

- [ ] **Step 3: Create the dApp proxy component**

Create `components/dapp-proxy.tsx`:
```typescript
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DappTxConfirmModal } from "@/components/dapp-tx-confirm-modal";
import { useWallet } from "@/components/wallet-provider";
import type { AptosNetwork } from "@/lib/aptos/client";

const PRESET_DAPPS = [
  { name: "Aries Markets", url: "https://ariesmarkets.xyz" },
];

interface DappProxyProps {
  multisigAddress: string;
  network: AptosNetwork;
  publicKeys: string[];
  threshold: number;
}

export function DappProxy({
  multisigAddress,
  network,
  publicKeys,
  threshold,
}: DappProxyProps) {
  const router = useRouter();
  const { connected, verifyIdentity } = useWallet();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [dappUrl, setDappUrl] = useState("");
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingTx, setPendingTx] = useState<{
    payload: { function: string; arguments: string[]; type_arguments: string[] };
    requestId: number;
  } | null>(null);

  const loadDapp = () => {
    if (!dappUrl) return;
    setLoadedUrl(dappUrl);
    setError(null);
  };

  // Handle messages from the iframe's injected wallet
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (event.data?.type !== "MULTISIG_WALLET_REQUEST") return;

      const { id, method, params } = event.data;
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return;

      const respond = (result: unknown) => {
        iframe.contentWindow!.postMessage(
          { type: "MULTISIG_WALLET_RESPONSE", id, result },
          "*"
        );
      };

      const respondError = (error: string) => {
        iframe.contentWindow!.postMessage(
          { type: "MULTISIG_WALLET_RESPONSE", id, error },
          "*"
        );
      };

      switch (method) {
        case "connect":
          respond({ address: multisigAddress, publicKey: multisigAddress });
          break;

        case "account":
          respond({ address: multisigAddress, publicKey: multisigAddress });
          break;

        case "network":
          respond({ name: network, chainId: network === "mainnet" ? "1" : "2" });
          break;

        case "disconnect":
          respond({});
          break;

        case "isConnected":
          respond(true);
          break;

        case "signTransaction":
        case "signAndSubmitTransaction":
          // Intercept — show confirmation modal
          setPendingTx({ payload: params, requestId: id });
          break;

        default:
          respondError(`Unsupported method: ${method}`);
      }
    },
    [multisigAddress, network]
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  const handleConfirmTx = async () => {
    if (!pendingTx) return;
    setError(null);

    try {
      const token = await verifyIdentity();

      // Parse the dApp's payload into our format
      const fnParts = pendingTx.payload.function.split("::");
      const moduleStr = `${fnParts[0]}::${fnParts[1]}`;
      const funcName = fnParts[2];

      const payload = {
        module: moduleStr,
        function: funcName,
        typeArgs: pendingTx.payload.type_arguments ?? [],
        args: pendingTx.payload.arguments ?? [],
      };

      const response = await fetch(
        `/api/multisig/${multisigAddress}/proposals`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            network,
            description: `dApp transaction: ${pendingTx.payload.function}`,
            payload,
            source: "dapp",
            sourceDappUrl: loadedUrl,
          }),
        }
      );

      if (!response.ok) {
        const err = await response.json();
        setError(err.error);
        return;
      }

      const data = await response.json();

      // Respond to the iframe with an error explaining multisig flow
      const iframe = iframeRef.current;
      if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage(
          {
            type: "MULTISIG_WALLET_RESPONSE",
            id: pendingTx.requestId,
            error:
              "Transaction routed to multisig. Proposal created — collect signatures and submit separately.",
          },
          "*"
        );
      }

      setPendingTx(null);

      // Navigate to the proposal
      router.push(`/tx/${data.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleCancelTx = () => {
    if (pendingTx && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        {
          type: "MULTISIG_WALLET_RESPONSE",
          id: pendingTx.requestId,
          error: "User cancelled the transaction",
        },
        "*"
      );
    }
    setPendingTx(null);
  };

  if (!connected) {
    return <p>Connect your Petra wallet to use the dApp proxy.</p>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>dApp Browser</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>dApp URL</Label>
            <div className="flex gap-2">
              <Input
                value={dappUrl}
                onChange={(e) => setDappUrl(e.target.value)}
                placeholder="https://ariesmarkets.xyz"
                className="font-mono text-xs"
              />
              <Button onClick={loadDapp}>Load</Button>
            </div>
          </div>

          <div className="flex gap-2">
            {PRESET_DAPPS.map((d) => (
              <Button
                key={d.url}
                variant="outline"
                size="sm"
                onClick={() => {
                  setDappUrl(d.url);
                  setLoadedUrl(d.url);
                }}
              >
                {d.name}
              </Button>
            ))}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {loadedUrl && (
        <div className="border rounded-lg overflow-hidden" style={{ height: "70vh" }}>
          <iframe
            ref={iframeRef}
            src={loadedUrl}
            className="w-full h-full"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onError={() => setError("Failed to load dApp. It may block being embedded in an iframe.")}
          />
        </div>
      )}

      <DappTxConfirmModal
        open={!!pendingTx}
        payload={pendingTx?.payload ?? null}
        dappUrl={loadedUrl ?? ""}
        onConfirm={handleConfirmTx}
        onCancel={handleCancelTx}
      />
    </div>
  );
}
```

- [ ] **Step 4: Create the dApp proxy page**

Create `app/multisig/[address]/dapp/page.tsx`:
```typescript
import { db } from "@/lib/db";
import { multisigs } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { DappProxy } from "@/components/dapp-proxy";
import type { AptosNetwork } from "@/lib/aptos/client";

interface Props {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ network?: string }>;
}

export default async function DappProxyPage({ params, searchParams }: Props) {
  const { address } = await params;
  const { network: networkParam } = await searchParams;
  const network = (networkParam ?? "mainnet") as AptosNetwork;

  const multisig = await db.query.multisigs.findFirst({
    where: and(
      eq(multisigs.address, address),
      eq(multisigs.network, network)
    ),
  });

  if (!multisig) notFound();

  const publicKeys: string[] = JSON.parse(multisig.publicKeys);

  return (
    <div className="max-w-5xl mx-auto">
      <DappProxy
        multisigAddress={address}
        network={network}
        publicKeys={publicKeys}
        threshold={multisig.threshold}
      />
    </div>
  );
}
```

- [ ] **Step 5: Test the iframe injection approach**

The injection script (`public/dapp-wallet-inject.js`) needs to be loaded by the iframe. However, cross-origin iframes cannot have scripts injected directly. The approach requires one of:

1. **Proxy the dApp through our server** — rewrite HTML to inject the script (complex but reliable)
2. **Use `srcdoc` with a wrapper** — load a page that creates an inner iframe and injects the script
3. **Browser extension approach** — not applicable for a web app

For the MVP, the simplest working approach is to serve a proxy page that loads the dApp and injects our script. This is a known limitation documented in the spec. Add a comment in the code noting this requires further refinement.

Run: `npm run dev` and navigate to `/multisig/{address}/dapp` to verify the page renders.

- [ ] **Step 6: Commit**

```bash
git add app/multisig/\[address\]/dapp/ components/dapp-proxy.tsx components/dapp-tx-confirm-modal.tsx public/dapp-wallet-inject.js
git commit -m "feat: add dApp iframe proxy with wallet interception for multisig transaction capture"
```

---

## Phase 6: Network Switcher & Polish

### Task 14: Network Switcher Component

**Files:**
- Create: `components/network-switcher.tsx`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Create network switcher**

Create `components/network-switcher.tsx`:
```typescript
"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWallet } from "@/components/wallet-provider";
import type { AptosNetwork } from "@/lib/aptos/client";

const NETWORKS: { value: AptosNetwork; label: string }[] = [
  { value: "mainnet", label: "Mainnet" },
  { value: "testnet", label: "Testnet" },
  { value: "devnet", label: "Devnet" },
];

export function NetworkSwitcher() {
  const { network } = useWallet();

  return (
    <Select value={network ?? "mainnet"} disabled>
      <SelectTrigger className="w-[130px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {NETWORKS.map((n) => (
          <SelectItem key={n.value} value={n.value}>
            {n.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

Note: The network is read from Petra (read-only in the UI). To switch networks, users change it in Petra. The select is disabled and just displays the current network.

- [ ] **Step 2: Wire into layout**

Update `app/layout.tsx` header to include the network switcher:
```typescript
import { NetworkSwitcher } from "@/components/network-switcher";

// In the header:
<header className="flex items-center justify-between p-4 border-b">
  <h1 className="text-lg font-semibold">Aptos Multisig</h1>
  <div className="flex items-center gap-3">
    <NetworkSwitcher />
    <ConnectWalletButton />
  </div>
</header>
```

- [ ] **Step 3: Commit**

```bash
git add components/network-switcher.tsx app/layout.tsx
git commit -m "feat: add network switcher displaying current Petra network"
```

---

### Task 15: End-to-End Verification

**No new files.** This task is a manual verification checklist.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Create a test multisig on devnet**

1. Open browser, connect Petra (set to Devnet)
2. Navigate to `/multisig/create`
3. Note your public key (auto-added)
4. Add 1-2 additional test public keys (can generate via Aptos SDK or use a second Petra account)
5. Set threshold to 2
6. Click "Preview Address" → verify address is derived
7. Click "Create Multisig" → verify redirect to dashboard

- [ ] **Step 3: Fund the multisig on devnet**

Use the Aptos devnet faucet to send APT to the multisig address.

- [ ] **Step 4: Create a proposal**

1. Navigate to `/multisig/{address}/propose`
2. Create an APT transfer: module=`0x1`, name=`aptos_account`, function=`transfer`, args=`{recipient}, 100`
3. Click "Create Proposal"
4. Copy the shareable link

- [ ] **Step 5: Sign from a second account**

1. Open the shareable link in an incognito window or second browser profile
2. Connect a second Petra wallet (must be one of the multisig signers)
3. Verify the proposal details display correctly
4. Click "Sign Transaction"
5. Verify the status updates

- [ ] **Step 6: Submit the transaction**

1. When threshold is met (status = "ready"), click "Submit Transaction"
2. Verify the transaction hash is returned
3. Check the transaction on Aptos Explorer for devnet

- [ ] **Step 7: Test the dApp proxy**

1. Navigate to `/multisig/{address}/dapp`
2. Load a dApp URL (try Aries Markets or a simple test dApp)
3. Note any iframe blocking issues (expected for some dApps)
4. If it loads, interact and verify the transaction capture flow

---

## Important Implementation Notes

### Petra signTransaction vs signMessage

The plan uses `signMessage` as the signing mechanism for collecting individual Ed25519 signatures. This is because Petra's `signTransaction` may not support signing a transaction where the sender address differs from the connected wallet. **During implementation, verify the exact Petra API behavior** and adjust:

- If Petra's `signTransaction` works with arbitrary sender addresses → use it (preferred, as it produces the correct signing message hash)
- If not → use `signMessage` with the transaction's signing message bytes, then verify signatures server-side

### Cross-Origin Iframe Injection

The dApp proxy (`Task 13`) has a known limitation: you cannot inject JavaScript into a cross-origin iframe directly. The `public/dapp-wallet-inject.js` approach requires the iframe content to load our script, which cross-origin iframes won't do. Implementation options:

1. **Server-side HTML proxy** — fetch the dApp HTML server-side, inject the script tag, serve via our own route
2. **Service worker** — intercept the iframe's requests and inject the script
3. **Accept the limitation** — document that only dApps that explicitly allow embedding will work, and provide the manual entry function builder as the primary alternative

Choose the approach during implementation based on testing with actual dApps.

### SQLite Integer Limits

SQLite integers are 64-bit, but JavaScript `Number` has ~53-bit precision. For sequence numbers and timestamps this is fine, but for large APT amounts in arguments, use string serialization in the `args` JSON field.
