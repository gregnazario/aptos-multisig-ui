# Aptos Offchain MultiEd25519 Multisig UI — Design Specification

## Overview

A Next.js web application for managing Aptos MultiEd25519 multisig treasury accounts. Enables teams to create K-of-N multisig accounts, propose transactions, collect Ed25519 signatures offchain via shareable links, and submit combined MultiEd25519-signed transactions to the Aptos blockchain.

**Authentication scheme:** MultiEd25519 (legacy Aptos protocol-level K-of-N threshold signing, scheme identifier `0x01`). This is NOT the on-chain Multisig v2 module — all signature coordination happens offchain.

**Wallet support:** Petra wallet only.

**Networks:** Mainnet, Testnet, Devnet (user-selectable per multisig).

**Transaction modes:**
1. **Arbitrary entry function** — manually specify module, function, type args, and arguments
2. **dApp proxy (iframe)** — embed an AIP-62 compatible dApp (e.g., Aries Markets) in an iframe, intercept transaction requests, and route them through the multisig signing flow

---

## Architecture

### Approach: Link-Centric with Dashboard

- **Shareable links** (`/tx/{proposalId}`) are the primary mechanism for signature collection. A proposer creates a transaction, gets a link, and shares it with co-signers.
- **Read-only dashboard** (`/multisig/{address}`) shows all proposals for a multisig, their status, balances, and signer activity. No authentication required — keyed by the public multisig address.
- **Lightweight backend** via Next.js API routes + SQLite/Turso for persistence.
- **No user accounts or sessions** — the connected Petra wallet is the identity. Signer verification is done via a signature challenge per session.

### Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js (App Router) |
| Database | SQLite (dev) / Turso (production) |
| ORM | Drizzle ORM |
| Aptos SDK | `@aptos-labs/ts-sdk` |
| Wallet | Petra wallet (`@petra-wallet/sdk` or window.petra) |
| Styling | Tailwind CSS + shadcn/ui |
| Deployment | Vercel |

---

## Data Model

### `multisigs`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID, PK | Internal identifier |
| `address` | text, unique per network | Aptos account address (derived from MultiEd25519PublicKey) |
| `public_keys` | JSON (text[]) | Ordered array of hex-encoded Ed25519 public keys |
| `threshold` | integer | K in K-of-N |
| `network` | text (enum) | `mainnet` / `testnet` / `devnet` |
| `label` | text, nullable | Optional human-readable name |
| `created_at` | timestamp | |

### `proposals`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID, PK | Used in shareable URL `/tx/{id}` |
| `multisig_id` | FK → multisigs | |
| `description` | text | Human-readable memo (what this transaction does) |
| `source` | text (enum) | `manual` (arbitrary entry function) or `dapp` (captured from iframe proxy) |
| `source_dapp_url` | text, nullable | If source is `dapp`, the URL of the originating dApp |
| `payload` | JSON | Entry function call for display: `{ module, function, type_args, args }` |
| `raw_transaction_bytes` | text (hex) | Canonical BCS-serialized RawTransaction — the exact bytes all signers sign |
| `sequence_number` | bigint | From the RawTransaction, stored for display/querying |
| `max_gas_amount` | bigint | |
| `gas_unit_price` | bigint | |
| `expiration_timestamp_secs` | bigint | Unix timestamp — proposal invalid after this time |
| `fee_payer_address` | text (hex), nullable | If sponsored, the fee payer's address |
| `fee_payer_signature` | text (hex), nullable | Fee payer's Ed25519Signature (set when fee payer signs) |
| `status` | text (enum) | `pending` / `ready` / `submitted` / `expired` / `failed` |
| `tx_hash` | text, nullable | Set after successful on-chain submission |
| `created_by` | text (hex) | Public key of the proposer |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

**Status transitions:** `pending` → `ready` (threshold met) → `submitted` (sent to chain). Also `pending`/`ready` → `expired` (past expiration), `submitted` → `failed` (chain rejected).

### `signer_responses`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID, PK | |
| `proposal_id` | FK → proposals | |
| `signer_index` | integer | Position in the multisig's public key array (0-based) |
| `public_key` | text (hex) | The signer's Ed25519 public key |
| `response` | text (enum) | `signed` / `declined` |
| `signature` | text (hex), nullable | Ed25519Signature bytes (null if declined) |
| `decline_reason` | text, nullable | Optional reason for declining |
| `created_at` | timestamp | |

**Unique constraint:** `(proposal_id, signer_index)` — one response per signer per proposal.

---

## Page Structure

```
app/
├── page.tsx                          # Landing — create or import a multisig
├── multisig/
│   ├── create/page.tsx               # Guided multisig creation flow
│   ├── import/page.tsx               # Import existing multisig (paste keys + threshold)
│   └── [address]/
│       ├── page.tsx                   # Dashboard — proposals, balances, signer info
│       ├── propose/page.tsx          # Create a new transaction proposal (arbitrary entry fn)
│       └── dapp/page.tsx             # dApp proxy — iframe with wallet interceptor
├── tx/
│   └── [proposalId]/page.tsx         # Shareable signing page
└── layout.tsx                        # Network switcher, Petra connect, global nav
```

## API Routes

```
app/api/
├── multisig/
│   ├── route.ts                      # POST: register a multisig
│   └── [address]/
│       ├── route.ts                  # GET: fetch multisig details
│       └── proposals/route.ts        # GET: list proposals, POST: create proposal
├── proposal/
│   └── [id]/
│       ├── route.ts                  # GET: proposal details + signer responses
│       ├── sign/route.ts             # POST: submit a signature
│       ├── decline/route.ts          # POST: decline with optional reason
│       └── submit/route.ts           # POST: combine sigs + submit to chain
├── verify/route.ts                   # POST: wallet signature challenge (nonce-based)
└── gas-station/
    └── sponsor/route.ts             # POST: fee payer signs a proposal
```

---

## Core Flows

### 1. Multisig Creation

1. User navigates to `/multisig/create`
2. Connects Petra wallet — their public key is auto-added as signer #0
3. Adds additional signer public keys (paste hex or invite others to connect Petra)
4. Sets threshold K (validated: 1 ≤ K ≤ N, N ≤ 32)
5. App derives the MultiEd25519 address: `sha3-256(pk_0 | pk_1 | ... | pk_n | K | 0x01)`
6. Displays derived address — user confirms
7. Backend stores the multisig registration
8. Redirects to dashboard `/multisig/{address}`

### 2. Multisig Import

1. User navigates to `/multisig/import`
2. Pastes: ordered public keys (one per line), threshold K, optional expected address
3. App derives the address from the provided keys + threshold
4. If expected address was provided:
   - **Error** if derived address doesn't match the provided one
   - **Warning** if on-chain auth key lookup doesn't match (may indicate key rotation)
5. Backend stores the multisig registration
6. Redirects to dashboard

### 3. Transaction Proposal Creation (Mode 1: Arbitrary Entry Function)

1. Proposer navigates to `/multisig/{address}/propose`
2. Connects Petra → signature challenge verifies they are a signer
3. Builds the transaction:
   - Entry function: module address, module name, function name
   - Type arguments (if any)
   - Function arguments (with type-aware input fields)
   - Gas settings: max gas amount, gas unit price (with sane defaults)
   - Expiration: default 24 hours, customizable
   - Fee payer toggle: off (self-pay) or on (enter fee payer address OR use auto gas station)
4. App fetches current sequence number from chain
5. App warns if there are other pending proposals with lower sequence numbers
6. App constructs the `RawTransaction` (or `FeePayerRawTransaction`) and BCS-serializes it
7. Proposer signs the raw bytes via `petra.signTransaction()`
8. Backend stores the proposal (source=`manual`) + proposer's signature
9. Returns shareable link `/tx/{proposalId}` — proposer copies and shares with co-signers

### 3b. Transaction Proposal Creation (Mode 2: dApp Proxy via Iframe)

This mode allows users to interact with existing AIP-62 compatible dApps (e.g., Aries Markets at ariesmarkets.xyz) through the multisig. The dApp runs inside an iframe, and the multisig UI intercepts wallet calls.

**Architecture:**

The dApp proxy page (`/multisig/{address}/dapp`) embeds the target dApp in an iframe. The multisig UI injects a **fake AIP-62 wallet adapter** into the iframe via `postMessage` communication. When the dApp calls wallet methods (like `signAndSubmitTransaction`), the injected adapter:

1. Intercepts the call instead of routing to Petra
2. Returns the multisig address as the "connected account"
3. Captures the transaction payload when the dApp requests signing
4. Routes the payload to the multisig proposal creation flow

**Flow:**

1. Proposer navigates to `/multisig/{address}/dapp`
2. Connects Petra → signature challenge verifies they are a signer
3. Enters the target dApp URL (e.g., `https://ariesmarkets.xyz`) or selects from a preset list
4. dApp loads in an iframe
5. The injected wallet adapter responds to the dApp's `connect()` call with the multisig's address
6. User interacts with the dApp normally (e.g., deposits collateral on Aries)
7. When the dApp calls `signAndSubmitTransaction(payload)`:
   - The adapter intercepts the payload (entry function + args)
   - The adapter sends the payload to the parent frame via `postMessage`
   - The multisig UI shows a confirmation modal: "This dApp wants to execute: [function details]"
   - User confirms → standard proposal creation flow kicks in (fetch seq number, build RawTransaction, proposer signs, store proposal)
8. Backend stores the proposal with source=`dapp` and source_dapp_url
9. Returns shareable link for other signers

**Injected Wallet Adapter Details:**

The adapter is a content script injected into the iframe that implements the AIP-62 wallet standard interface:
- `connect()` → returns `{ address: multisigAddress, publicKey: multiEd25519PublicKey }`
- `disconnect()` → no-op
- `signTransaction(payload)` → sends payload to parent via `postMessage`, returns a pending promise that resolves when the multisig proposal is created
- `signAndSubmitTransaction(payload)` → same as `signTransaction` but the dApp expects a tx hash back — we return a placeholder or the proposal ID, since actual submission happens later after threshold signatures
- `account()` → returns the multisig address and network info
- `network()` → returns the current network matching the multisig's network

**Limitations & Considerations:**
- **Cross-origin iframe restrictions**: The dApp must allow being embedded in an iframe (no `X-Frame-Options: DENY` or restrictive `frame-ancestors` CSP). Some dApps may block this.
- **`signAndSubmitTransaction` mismatch**: The dApp expects an immediate tx hash, but multisig submission is deferred. The adapter will throw a descriptive error after capturing the payload, telling the dApp that submission is handled by the multisig. The multisig UI catches this and shows the proposal creation modal. This is preferable to returning a fake tx hash, which could mislead the dApp into thinking the transaction succeeded.
- **View functions**: The adapter should proxy `view` calls to the actual Aptos node so the dApp can read on-chain state correctly for the multisig address.
- **Preset dApp list**: Maintain a curated list of tested dApps (starting with Aries Markets) that are confirmed to work in the iframe proxy. Show warnings for untested URLs.
- **Security**: The iframe is sandboxed. The `postMessage` protocol uses origin checking to prevent malicious messages.

### 4. Signature Collection (Shareable Link)

1. Signer opens `/tx/{proposalId}`
2. Page displays: description, entry function details, gas settings, expiration countdown, signer status grid
3. Signer connects Petra → signature challenge verifies identity
4. App checks: Petra's network matches the proposal's network
5. App identifies which signer index they are from the multisig's public key list
6. Signer reviews the proposal and either:
   - **Signs**: Petra signs the stored `raw_transaction_bytes` → signature POSTed to `/api/proposal/{id}/sign`
   - **Declines**: Optional reason → POSTed to `/api/proposal/{id}/decline`
7. Backend validates the signature against the raw bytes and the signer's public key
8. If total signed count ≥ threshold K, status updates to `ready`

### 5. Transaction Submission

When a proposal reaches `ready` status:

**Self-pay flow:**
1. Any signer (or the app automatically) can trigger submission
2. App constructs `MultiEd25519Signature` from collected signatures + bitmap
3. App builds `AccountAuthenticatorMultiEd25519(multiPubKey, multiSig)`
4. Submits the signed transaction to the Aptos fullnode
5. Backend updates status to `submitted` with `tx_hash`

**Sponsored (manual fee payer) flow:**
1. Fee payer opens the proposal link or a dedicated fee-payer URL
2. Connects Petra (must match the `fee_payer_address` on the proposal)
3. Signs the `FeePayerRawTransaction` bytes
4. App combines: multisig authenticator + fee payer authenticator
5. Submits and updates status

**Sponsored (auto gas station) flow:**
1. When threshold is met, the backend's gas station key automatically signs as fee payer
2. Submits immediately without manual fee payer intervention
3. Requires a backend-held Ed25519 private key (configured via environment variable)

### 6. Sequence Number Handling

- Multiple proposals can be created with different sequence numbers
- The UI displays proposals in sequence number order
- **Warnings shown when:**
  - A proposal's sequence number is not the next expected one for the account
  - Submitting a proposal would skip over pending proposals with lower sequence numbers
  - The on-chain sequence number has advanced past a proposal's sequence number (proposal is stale)
- Users manage ordering themselves — the app informs but does not enforce

---

## Signer Verification (Signature Challenge)

When a user connects Petra and wants to interact with a multisig:

1. Frontend requests a nonce from `/api/verify` (or generates one client-side with a timestamp)
2. Frontend asks Petra to sign a structured message: `"Aptos Multisig Verification\nNonce: {nonce}\nTimestamp: {timestamp}"`
3. Frontend sends `{ publicKey, signature, nonce, timestamp }` to `/api/verify`
4. Backend verifies:
   - The signature is valid for the message + public key
   - The nonce hasn't been used before (replay protection)
   - The timestamp is recent (e.g., within 5 minutes)
5. Returns a short-lived session token (JWT or similar) tied to the verified public key
6. Subsequent API calls include this token — backend checks the public key against the multisig's signer list

---

## Gas Station

### Configuration

The auto gas station requires:
- `GAS_STATION_PRIVATE_KEY` — Ed25519 private key (hex) for the fee payer account
- `GAS_STATION_ENABLED` — boolean toggle
- `GAS_STATION_MAX_GAS_PER_TX` — maximum gas amount the station will sponsor (safety cap)
- `GAS_STATION_NETWORKS` — which networks the station operates on

### Behavior

- When `fee_payer_address` matches the gas station's address AND auto-sponsor is enabled:
  - Backend automatically signs as fee payer when proposal reaches `ready`
  - Submits the transaction without waiting for manual fee payer action
- The gas station account must have sufficient APT balance on each enabled network
- Dashboard shows gas station balance and recent sponsorship activity

---

## Security

### Signature Integrity
- All signers sign the identical `raw_transaction_bytes` stored in the proposal
- Backend validates each submitted Ed25519 signature against the raw bytes and the signer's public key before storing
- Invalid signatures are rejected at the API level

### Replay Protection
- Chain-level: sequence numbers prevent transaction replay
- App-level: unique constraint on `(proposal_id, signer_index)` prevents duplicate signatures
- Verification nonces are single-use

### Network Isolation
- Proposals are scoped to a network via their parent multisig
- API routes validate that the connected wallet's network matches the proposal's network
- Separate Aptos client instances per network

### On-Chain Verification (Import)
- Address derivation is verified client-side: `sha3-256(pk_0 | ... | pk_n | K | 0x01)` must match
- Optional on-chain auth key lookup warns if the account's current auth key differs (possible key rotation)

### Backend Key Security (Gas Station)
- The gas station private key is stored as an environment variable, never in the database
- The gas station has a per-transaction gas cap to limit exposure
- Monitoring/alerts on gas station balance depletion

---

## UI Components

| Component | Purpose |
|-----------|---------|
| `WalletProvider` | Petra connection state, network awareness, auto-reconnect |
| `NetworkSwitcher` | Mainnet/testnet/devnet toggle in the header |
| `MultisigCreator` | Step-by-step: add signers, set threshold, confirm address |
| `MultisigImporter` | Paste keys + threshold, optional address check |
| `ProposalBuilder` | Entry function picker, arg inputs, gas config, fee payer toggle |
| `ProposalView` | Full proposal display with signing actions |
| `SignerStatusGrid` | Each signer: index, truncated pubkey, status badge (pending/signed/declined) |
| `ExpirationCountdown` | Live countdown to proposal expiry |
| `SequenceWarning` | Banner when sequence number ordering issues exist |
| `TransactionResult` | Post-submission: tx hash link, success/failure status |
| `DappProxy` | Iframe container for embedded dApps with wallet interceptor |
| `DappUrlInput` | URL input with preset dApp list (Aries Markets, etc.) |
| `DappTxConfirmModal` | Modal shown when dApp requests a transaction — shows payload details for review before routing to proposal creation |

---

## Technology Decisions

### Why MultiEd25519 (not MultiKey or Multisig v2)?
- MultiEd25519 is the established protocol-level scheme with well-understood behavior
- Petra wallet natively produces Ed25519 signatures
- No smart contract deployment needed
- Supports up to 32 signers with arbitrary thresholds

### Why SQLite/Turso (not Postgres)?
- Minimal infrastructure for an MVP
- Turso offers edge-compatible SQLite with replication for production
- Drizzle ORM works seamlessly with both local SQLite and Turso
- Easy to migrate to Postgres later if needed

### Why Petra only (not multi-wallet)?
- Simplifies wallet integration — one API surface to support
- Petra is the most widely used Aptos wallet
- Avoids complexity of abstracting over different wallet adapter APIs
- Can add more wallets later via `@aptos-labs/wallet-adapter-react` if needed

### Why shareable links (not on-chain coordination)?
- Faster iteration — no on-chain state to manage
- No gas cost for proposing or signing (only for final submission)
- Better UX for teams already using chat/email to coordinate
- On-chain Multisig v2 is an alternative but has different trade-offs (transparency vs. cost)

---

## Verification Plan

### Local Development Testing
1. Start local dev server (`npm run dev`)
2. Create a multisig with 2-of-3 threshold on devnet
3. Fund the multisig address via devnet faucet
4. Create an APT transfer proposal
5. Open shareable link in a second browser profile with a different Petra wallet
6. Sign with the second wallet
7. Verify proposal status transitions to `ready`
8. Submit the transaction and verify on-chain via Aptos Explorer

### Gas Station Testing
1. Configure a devnet gas station key
2. Create a fee-payer proposal pointing to the gas station address
3. Collect threshold signatures
4. Verify auto-submission occurs
5. Check the fee payer's balance decreased (not the multisig's)

### dApp Proxy Testing
1. Load Aries Markets (or a test dApp) in the iframe proxy on devnet
2. Verify the dApp sees the multisig address as the connected wallet
3. Initiate a transaction in the dApp (e.g., deposit)
4. Verify the payload is captured and the confirmation modal appears
5. Confirm → verify proposal is created with source=`dapp` and correct payload
6. Complete the signing flow via shareable link and submit

### Edge Cases to Verify
- Expired proposal cannot be signed or submitted
- Duplicate signature from same signer is rejected
- Wrong network wallet connection is blocked
- Import with mismatched address shows error
- Out-of-order sequence number submission shows warning
- Declined proposal with reasons displays correctly on the signer grid
- dApp with `X-Frame-Options: DENY` shows a clear error message
- dApp proxy correctly reports multisig balance and on-chain state via view functions
