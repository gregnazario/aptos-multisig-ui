# Admin page: browse all multisigs

**Date:** 2026-07-14
**Status:** Approved (design)

## Goal

Give admins a single page that lists every multisig registered on the current
network, shows each one's status (pending/ready/submitted proposal counts plus
on-chain APT balance and sequence number), and links to each multisig's
dashboard. Expose the page via a header link that only appears for admins.

## Context

- Admin identity is modeled two ways today:
  - **Passive** — `/api/admin/check` populates `useWallet().isAdmin` with no
    signature. Display-only; the server cannot trust a client claim, and public
    keys are public, so an endpoint cannot authorize by accepting a `publicKey`
    param.
  - **Cryptographic** — `verifyIdentity()` (signMessage → `/api/verify`) issues a
    JWT (`SessionPayload`, includes `isAdmin`) verified by `verifySessionToken`.
- `verify-signer.ts` is the established pattern for gating an API route on a JWT.
- `AdminMultisigCreator` is already gated by `isAdmin` inside `multisig-creator.tsx`
  — the precedent for admin-only UI.
- `multisigs` table stores only config (address, publicKeys, threshold, network,
  label, createdAt). Richer "status" must be aggregated from `proposals`
  (status enum: pending|ready|submitted|expired|failed) or fetched from RPC via
  `getAptosClient(network)`.
- Data is scoped per-network throughout the app.

## Decisions

- **Authorization:** signed admin JWT, re-checked server-side.
- **Status shown:** both proposal counts (DB) and on-chain info (APT balance +
  sequence number, best-effort).
- **Scope:** current network only.
- **Entry point:** header link next to the admin badge, shown only when `isAdmin`.
- **Balance:** APT only (not all fungible assets).

## Components

### 1. Auth helper — `src/lib/auth/verify-admin.ts`

Mirrors `verify-signer.ts`. Signature:

```
verifyAdmin(authHeader: string | null):
  Promise<{ ok: true; session: SessionPayload }
        | { ok: false; response: NextResponse }>
```

- Missing/`non-Bearer` header → 401.
- Invalid/expired JWT → 401.
- Valid JWT but `isAdmin(session.publicKey)` is false → 403.
- Otherwise `{ ok: true, session }`.

Re-derives admin status server-side via `isAdmin(session.publicKey)` rather than
trusting the token's `isAdmin` claim.

### 2. API — `GET /api/admin/multisigs?network=<net>`

- Gate with `verifyAdmin(request.headers.get("authorization"))`.
- Validate `network` against `["mainnet","testnet","devnet"]` (400 otherwise).
- Query all `multisigs` where `network = net`.
- For each multisig, in parallel:
  - Aggregate `proposals` (where `multisigId = ms.id`) grouped by `status` into
    `proposalCounts: { pending, ready, submitted, expired, failed }` (missing
    statuses default to 0).
  - Best-effort fetch APT balance and sequence number via `getAptosClient(net)`.
    Any RPC error degrades that multisig to `onChain: "unavailable"` with
    `balanceApt: null, sequenceNumber: null`; it never fails the whole response.
- Response: array of
  ```
  {
    id, address, label, threshold, signerCount, network, createdAt,
    proposalCounts: { pending, ready, submitted, expired, failed },
    balanceApt: number | null,
    sequenceNumber: number | null,
    onChain: "ok" | "unavailable"
  }
  ```

### 3. Page — `src/app/admin/page.tsx` (client component)

- Uses `useWallet()` (`connected, isAdmin, network, verifyIdentity`).
- Guard states:
  - not connected → prompt to connect wallet.
  - connected but `!isAdmin` → "Not authorized" message.
  - admin → on mount (and on network change) call `verifyIdentity()` to obtain
    the JWT (one wallet signature), then
    `fetch('/api/admin/multisigs?network=<net>', { headers: { Authorization: 'Bearer ' + token } })`.
- Renders a scrollable grid of cards (reuse the `my-multisigs.tsx` card pattern):
  label, mono address, `threshold-of-N` + network badges, proposal-status badges
  (pending/ready/submitted counts), balance + sequence number (or "—" when
  unavailable), and an **Open Dashboard** link → `/multisig/{address}?network={net}`.
- Client-side search/filter box (by label or address substring) for scrolling.
- Loading / error / empty ("No multisigs registered on {network}") states.

### 4. Entry point — `src/components/admin-nav-link.tsx`

Same shape as `admin-badge.tsx`: `"use client"`, reads `useWallet()`, returns
`null` unless `connected && isAdmin`, otherwise a `Link` to `/admin` styled as a
header nav link. Rendered in `layout.tsx` next to `<AdminBadge />`.

## Data flow

connect → passive `isAdmin` true → header shows Admin link → click `/admin` →
`verifyIdentity()` signs message → JWT → `GET /api/admin/multisigs` (Bearer) →
server `verifyAdmin` + DB aggregate + RPC → cards → Open Dashboard →
`/multisig/{address}`.

## Error handling

- 401/403 from the API → page shows "Not authorized — reconnect your wallet".
- Per-multisig RPC failure → card shows "—" for balance/sequence, page still
  renders (`onChain: "unavailable"`).
- Empty result → friendly empty-state message naming the current network.

## Testing

- Unit test `src/lib/auth/verify-admin.ts` following existing auth/test style:
  - valid admin JWT → `ok: true`
  - valid non-admin JWT → 403
  - missing/`non-Bearer` header → 401
  - invalid/expired JWT → 401
- Manual end-to-end verification: connect an admin wallet, open `/admin`, confirm
  list, status badges, balances, filter, and Open Dashboard navigation.

## Scope / YAGNI

- No pagination — current-network lists are expected to be small; the client-side
  filter covers "scrolling". Pagination + on-demand balance loading is the
  follow-up if lists grow large.
- APT balance only; no full fungible-asset enumeration.
