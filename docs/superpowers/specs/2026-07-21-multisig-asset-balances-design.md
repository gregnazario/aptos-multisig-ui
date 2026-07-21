# Multisig asset balances + transfer proposals

**Date:** 2026-07-21
**Status:** Approved (cloud agent; requirements explicit in request)

## Goal

On each multisig dashboard, show every non-zero coin and fungible-asset
balance for the account (sourced from the Aptos indexer), and offer a
**Transfer** action per asset that opens the existing propose flow prefilled
with the correct entry function.

## Context

- Dashboard today (`/multisig/[address]`) shows config, signers, and proposals
  only. Admin list shows APT only via `getAccountAPTAmount`.
- Simulation already distinguishes `coin` vs `fa` balance changes and enriches
  them via `getAssetMetadata`.
- Propose flow uses `ProposalBuilder` + `AbiFunctionForm`; `/propose` already
  reads URL query params for prefills, but the multisig-scoped propose page
  does not.

## Decisions

- **Data source:** Aptos TS SDK `getAccountCoinsData` (indexer
  `current_fungible_asset_balances`), not per-resource RPC walks.
- **Classification:** `token_standard === "v1"` → coin; `"v2"` → fungible
  asset. Fallback: `asset_type` containing `::` → coin, else FA.
- **Zero balances:** omit rows with `amount <= 0`.
- **Transfer targets:**
  - Coin → `0x1::aptos_account::transfer_coins<CoinType>(to, amount)`
  - FA → `0x1::primary_fungible_store::transfer<0x1::fungible_asset::Metadata>(metadata, to, amount)`
- **UX:** Transfer is a link into `/multisig/{address}/propose` with query
  params that prefill module/function/type args (and FA metadata arg). User
  still enters recipient and amount in the ABI form, then creates a proposal
  as today. No new on-chain submit path.
- **Auth:** balances are public on-chain data; endpoint is unauthenticated but
  scoped to a registered multisig address+network (404 if unknown), matching
  other multisig read APIs.
- **Errors:** indexer failures return 502 with a message; UI shows an error
  state and does not block the rest of the dashboard.

## Components

### 1. Lib — `src/lib/aptos/balances.ts`

Pure helpers (unit-tested):

- Normalize indexer rows → `AccountAssetBalance[]`
- Build propose-page query params / href for a balance

```ts
interface AccountAssetBalance {
  asset: string;          // coin type or FA metadata address
  amount: string;         // base units as decimal string
  kind: "coin" | "fa";
  symbol?: string;
  name?: string;
  decimals?: number;
  isFrozen?: boolean;
  isPrimary?: boolean;
}
```

### 2. API — `GET /api/multisig/[address]/balances?network=<net>`

- Validate network; load multisig from DB (404 if missing).
- Call `getAptosClient(network).getAccountCoinsData({ accountAddress, options: { where: { amount: { _gt: 0 } }, limit: 100, orderBy: [{ amount: "desc" }] } })`.
- Map via helpers; return `{ address, network, balances }`.

### 3. UI — `AccountBalances` client component

- Fetches the API on mount / network change.
- Lists symbol (or short asset id), formatted amount, Coin/FA badge, Transfer
  button linking to the prefilled propose URL.
- Loading / empty / error states.

### 4. Prefill — propose page + `ProposalBuilder`

- Multisig propose page reads `module`, `name`, `function`, `type_args`,
  `args`, `desc` from searchParams and passes them as initials.
- `ProposalBuilder` seeds its module/function/description state and forwards
  `initialTypeArgs` / `initialArgs` to `AbiFunctionForm`.

## Out of scope

- Inline recipient/amount dialog that auto-creates the proposal
- NFT / digital asset balances
- Admin page multi-asset enrichment
- Refresh after proposal submission
