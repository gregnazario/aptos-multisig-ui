# MSAFE_COMPATIBILITY

A practical guide to operating a legacy MultiEd25519 treasury wallet using this
app, including how to interact with Aptos dApps that don't natively offer a
multisig integration.

This is a self-contained guide. It assumes you're comfortable with a terminal,
browser DevTools, and the basics of an Aptos wallet (Petra, Nightly, etc.), but
not deep Move / BCS knowledge.

## Table of contents

1. [What this guide covers](#what-this-guide-covers)
2. [Prerequisites](#prerequisites)
3. [Running the app](#running-the-app)
4. [Importing an existing multisig wallet](#importing-an-existing-multisig-wallet)
5. [Day-to-day operations: simple transfers](#day-to-day-operations-simple-transfers)
6. [Interacting with dApps](#interacting-with-dapps)
   - [Method A — the built-in dApp browser](#method-a--the-built-in-dapp-browser)
   - [Method B — Nightly wallet in watch-only mode](#method-b--nightly-wallet-in-watch-only-mode)
7. [Worked example: a Thala swap](#worked-example-a-thala-swap)
8. [Worked example: a PancakeSwap swap](#worked-example-a-pancakeswap-swap)
9. [Manual fallback: building a payload from scratch](#manual-fallback-building-a-payload-from-scratch)
10. [Collecting signatures](#collecting-signatures)
11. [Simulating, retrying, and submitting](#simulating-retrying-and-submitting)
12. [Troubleshooting / FAQ](#troubleshooting--faq)
13. [Future: a dedicated extension](#future-a-dedicated-extension)

---

## What this guide covers

This app manages **MultiEd25519** treasury wallets on Aptos at the protocol
level. It is fully compatible with multisig accounts created by older
coordination services that use the same MultiEd25519 scheme, because the
underlying account is just a standard Aptos MultiEd25519 account — the
coordination layer is irrelevant once you control enough keys.

You will be able to:

- Import an existing MultiEd25519 wallet by address
- Build and sign arbitrary entry function transactions
- Interact with any Aptos dApp, even those that don't natively support multisig
- Collect signatures from co-signers via share links
- Submit the combined transaction directly to the chain

You will need:

- The wallet address
- Access to ≥ threshold of the owner private keys (held in browser wallets
  and/or as raw keys for offline signing)

---

## Prerequisites

- **Node.js 20+** and **pnpm**
- A browser wallet that holds your owner key:
  [Petra](https://petra.app) (desktop), Moveth, Rise, OKX, etc. Any
  standard Ed25519 wallet works.
- For capturing dApp transactions:
  [Nightly](https://nightly.app) browser extension
- Familiarity with browser DevTools (opening the Console tab)

---

## Running the app

### Quickstart (local development)

```bash
git clone <this repo>
cd aptos-multisig-ui

pnpm install
pnpm rebuild better-sqlite3
pnpm drizzle-kit push    # initialise local SQLite

# minimal .env.local
cat > .env.local <<'EOF'
DATABASE_URL=file:local.db
JWT_SECRET=change-me
EOF

pnpm dev
```

Open `http://localhost:3123`. Connect any standard Ed25519 wallet (e.g. Petra)
to authenticate yourself as a signer. The connected wallet is your *personal*
signing identity — not the multisig wallet itself.

### Building for production

```bash
pnpm build       # produces .next/
pnpm start       # serves the built app on port 3123
```

`pnpm start` is a long-running process. Behind a reverse proxy (nginx / Caddy /
Cloudflare) for TLS, you typically want a process supervisor — the included
Makefile assumes [pm2](https://pm2.keymetrics.io):

```bash
make install     # pnpm install + rebuild better-sqlite3
make build       # pnpm build
make db-push     # apply Drizzle schema
make restart     # pm2 restart multisig (or start if first run)
# convenience: make deploy = install + build + db-push + restart
```

`make logs` / `make status` give you pm2 visibility, and `make update` pulls
main and redeploys.

### Makefile reference

| Target | What it does |
|---|---|
| `make install` | `pnpm install` + `pnpm rebuild better-sqlite3` |
| `make dev` | Dev server (`pnpm dev`) |
| `make build` | Production build (`pnpm build`) |
| `make start` | Run the production server (`pnpm start`) |
| `make deploy` | Full deploy: install + build + db-push + restart pm2 |
| `make restart` | `pm2 restart multisig` (starts if not running) |
| `make logs` | `pm2 logs multisig` |
| `make status` | `pm2 status` |
| `make db-push` | `pnpm drizzle-kit push` — sync schema to the DB |
| `make db-studio` | `pnpm drizzle-kit studio` — open the DB inspector in the browser |
| `make lint` / `make format` / `make test` | Biome lint, Biome format, Vitest |
| `make update` | `git pull` then `make deploy` |
| `make clean` | Remove `.next/` and `node_modules/` |

### Environment variables — complete reference

| Variable | Required | Default | What it does |
|---|---|---|---|
| `DATABASE_URL` | **yes** | — | SQLite path, e.g. `file:local.db` (dev) or `file:/data/multisig.db` (prod). |
| `JWT_SECRET` | **yes** | — | Signing key for session JWTs issued at `/api/verify`. Must be stable across restarts and identical across split-deployment frontend + backend. Use a strong random value in production. |
| `GAS_STATION_ENABLED` | no | `false` | Set to `true` to enable the auto fee-payer. |
| `GAS_STATION_PRIVATE_KEY` | if gas station enabled | — | Hex Ed25519 private key (`0x…`) that auto-signs as fee payer when a proposal names the gas station's address as fee payer. |
| `GAS_STATION_MAX_GAS_PER_TX` | no | `10000` | Cap on gas units the gas station will pay per transaction (safety guard). |
| `GAS_STATION_NETWORKS` | no | empty | Comma-separated networks where auto-sponsorship is active, e.g. `devnet,testnet`. Mainnet is off by default. |
| `BACKEND_URL` | only on a split frontend | — | URL of the backend API for split deployments (see below). |
| `CORS_ORIGIN` | only on a split backend | — | Origin allowed by CORS on the backend. |
| `ADMIN_PUBLIC_KEYS` | no | empty | Comma-separated Ed25519 public keys whose holders gain admin actions (e.g. submitting on behalf of a wallet). Optional. |

### Selecting an Aptos network

The network (`mainnet` / `testnet` / `devnet`) is a **per-multisig setting** —
chosen when you create or import the wallet, and stored alongside the
multisig's keys. Each proposal inherits its parent multisig's network.

There is no global "switch network" toggle for the whole app; the same
running instance can manage multisigs on different networks side by side.
Just make sure the wallet you connect with is currently on the network of
the multisig you're operating.

### Gas station — automated fee sponsorship

The gas station lets a single Ed25519 key automatically sign as the fee payer
for proposals from any of the multisigs the app manages. This is useful so
that the multisig wallet itself doesn't need to hold APT to pay gas — the
gas station's address pays from its balance.

To enable:

```env
GAS_STATION_ENABLED=true
GAS_STATION_PRIVATE_KEY=0x<hex>
GAS_STATION_MAX_GAS_PER_TX=10000
GAS_STATION_NETWORKS=devnet,testnet
```

How proposals use it: when you create a proposal, pick "Fee payer" and set
it to the gas station's address. On submission, if the proposal carries no
`feePayerSignature`, the server signs as the gas station automatically.
Failures are silent — submission proceeds without sponsorship if anything
goes wrong.

**Security notes:**

- The private key lives in env vars on the server. Treat the server as
  custodial for that key.
- `GAS_STATION_MAX_GAS_PER_TX` is the only guard against a misconfigured
  proposal draining the sponsor wallet. Keep it tight.
- Don't enable for `mainnet` until you understand the cost model — leave
  `GAS_STATION_NETWORKS` to test networks during initial setup.

### Database (SQLite via Drizzle)

The app uses a single SQLite file (`local.db` by default). Schema lives in
`src/lib/db/schema.ts` and is applied with Drizzle:

```bash
pnpm drizzle-kit push     # sync schema (idempotent)
pnpm drizzle-kit studio   # inspect tables in a browser UI
```

For production:

- **Backups** = copy the `.db` file. SQLite supports hot snapshots; on Linux
  you can `sqlite3 multisig.db ".backup '/path/snap.db'"` while the app
  runs.
- **Schema migrations** are applied by `make db-push` (= `pnpm drizzle-kit
  push`); run this after every deploy.
- **Concurrency**: SQLite uses single-writer locking. For tens to low
  hundreds of users this is fine. If you outgrow it, migrate to Postgres
  (Drizzle supports it; just change the driver).

### Split deployment

You can run the frontend (Next.js pages) on one host and the backend (the
API routes + SQLite database) on another. The same codebase is deployed to
both; the difference is env config.

**Backend host** (VPS, where the DB lives):

```env
DATABASE_URL=file:/data/multisig.db
JWT_SECRET=<shared-secret>
CORS_ORIGIN=https://app.example.com
```

```bash
make deploy   # builds and starts with pm2
```

**Frontend host** (Vercel or another Next.js host):

```env
BACKEND_URL=https://api.example.com
JWT_SECRET=<shared-secret>          # must match backend
```

```bash
pnpm build && pnpm start
```

`JWT_SECRET` must be identical on both — otherwise sessions issued by the
backend won't validate on the frontend.

### Known limitations

- **iframe dApp browser doesn't work on `localhost`** for any dApp whose
  third-party APIs (Alchemy, CoinGecko, etc.) whitelist by origin. Those
  APIs reject requests from `localhost`, so the dApp's UI hangs or errors.
  Deploy to a real domain for Method A, or use the Nightly workflow
  (Method B) which is unaffected.
- The app blocks **keyless / OAuth wallets** (Aptos Connect, Google, Apple)
  because they use non-Ed25519 keys that can't sit in a MultiEd25519 key
  set. Co-signers must use a standard Ed25519 wallet or sign offline.
- **SQLite single-writer locking** can become a bottleneck under heavy
  concurrent proposal creation. Tens of users → no problem.

---

## Importing an existing multisig wallet

Go to **Import → "Lookup by address"** and paste the multisig wallet address.

The lookup endpoint (`/api/multisig/lookup`) fetches the wallet's last 25
transactions and scans for a `multi_ed25519_signature` authenticator. Once it
finds one, it extracts the full public-key list and threshold from the
authenticator and reconstructs the wallet's configuration.

The address derived from those keys is compared against the input address. If
they match, the import succeeds — you can now propose transactions.

> **Why this works:** every MultiEd25519 transaction submitted from the wallet
> reveals the entire key set in the authenticator. Even a single past
> transaction is enough to reconstruct the wallet configuration. If the wallet
> has never sent a transaction yet, you'll need to use **"Enter public keys
> manually"** instead and provide all keys plus threshold.

After import, you can find the wallet on the home page and click into its
dashboard.

---

## Day-to-day operations: simple transfers

For a plain APT transfer:

1. From the wallet dashboard, click **Propose Transaction**
2. Select **Use ABI builder** (or paste a payload directly)
3. Module address: `0x1`
4. Module name: `aptos_account`
5. Function name: `transfer`
6. Type arguments: *(none)*
7. Function arguments:
   - `to`: recipient address (`0x...`)
   - `amount`: u64 octa amount (1 APT = `100000000`)
8. Click **Simulate** to dry-run, then **Save proposal**

Share the resulting URL with your co-signers (see
[Collecting signatures](#collecting-signatures)).

For fungible asset (FA) transfers, use `0x1::primary_fungible_store::transfer`
with a `0x1::object::Object<T>` type argument; the captured payload from a
dApp will tell you the exact metadata object address.

---

## Interacting with dApps

Most Aptos dApps assume the connected wallet is a single-key wallet that can
sign a transaction immediately. A multisig wallet cannot — it needs to
collect signatures over time. There are two ways to bridge that gap:

| Method | When to use | Strength |
|---|---|---|
| **A. Built-in dApp browser** | The dApp loads inside an iframe (no `X-Frame-Options`/CSP block) | Tight integration; captures the payload automatically |
| **B. Nightly watch-only capture** | Anything else, including most production DEX/CDP frontends | Universal — works with any dApp on any wallet-adapter site |

### Method A — the built-in dApp browser

The app includes an iframe-based dApp browser at
`/multisig/[address]/dapp`. It loads a dApp URL through a reverse proxy
(`/api/dapp-proxy`) and injects a fake wallet adapter that intercepts the
dApp's `signAndSubmitTransaction` call. The captured payload is routed back to
the app and turned into a multisig proposal automatically.

This works for dApps that allow iframe embedding. Many production sites set
`X-Frame-Options: DENY` or restrictive CSP and won't load. If you see a blank
iframe, fall back to Method B.

### Method B — Nightly wallet in watch-only mode

The Nightly wallet supports importing a watch-only address. When a dApp asks
this wallet to sign a transaction, Nightly logs the full payload to the
browser console — and then fails to sign (because there's no private key for a
watch-only address). The dApp will appear to hang or display a generic
"transaction failed" error, but the payload is in your console, ready to
copy.

#### One-time setup

1. Install the Nightly extension from [nightly.app](https://nightly.app)
2. Open Nightly → **Add wallet → Aptos → Watch only / Track address**
3. Paste your **multisig wallet address** and save
4. Make sure the watch-only address is the *active* wallet inside Nightly

#### Capturing a payload

1. Open the dApp in a new tab (e.g. `app.thala.fi`)
2. Open **DevTools → Console** (F12, then click *Console*)
3. Connect Nightly to the dApp — the dApp should show the multisig address as
   the connected account
4. Set up the action you want (token in, token out, amount, etc.)
5. Click the **action button** (Swap, Deposit, Stake, etc.)
6. The dApp will pause or show a "failed" error. **Don't dismiss it yet.**
7. Switch to the Console tab. Look for a `console.log` line with a JSON object
   that looks like one of these shapes:

   **Modern (AIP-62 / Aptos Wallet Standard):**
   ```json
   {
     "data": {
       "function": "0xabc...::router::swap_exact_input",
       "typeArguments": [
         "0x1::aptos_coin::AptosCoin",
         "0xabc...::usdc::USDC"
       ],
       "functionArguments": ["100000000", "12300000", "0xowner..."]
     }
   }
   ```

   **Legacy `entry_function_payload`:**
   ```json
   {
     "type": "entry_function_payload",
     "function": "0xabc...::router::swap_exact_input",
     "type_arguments": ["0x1::aptos_coin::AptosCoin", "0xabc...::usdc::USDC"],
     "arguments": ["100000000", "12300000", "0xowner..."]
   }
   ```

   Right-click the logged object → **Copy object** to grab the full JSON.

8. In a separate tab, open your multisig dashboard → **Propose Transaction**.
9. Either paste the JSON directly (if the form supports JSON input) or fill
   the ABI builder manually:

   | Form field | Where to get it |
   |---|---|
   | Module address | The part before `::` in `function` (e.g. `0xabc...`) |
   | Module name | The middle segment (e.g. `router`) |
   | Function name | The last segment (e.g. `swap_exact_input`) |
   | Type arguments | `typeArguments` / `type_arguments` array, one per line |
   | Function arguments | `functionArguments` / `arguments` array, in order |

10. **Simulate** the transaction. Save the proposal. Share the link with
    co-signers.

> **Tip:** if the console line is collapsed, click the disclosure triangle to
> expand it. You want the full payload, not just `[Object]`. If the payload is
> truncated in the console output, use *Copy object* — that copies the full
> structure, not just what's visible.

---

## Worked example: a Thala swap

Goal: swap 1 APT for USDC (or any pair) on app.thala.fi.

1. Open Nightly, switch active wallet to the watch-only multisig address.
2. Open `app.thala.fi` in a new tab, open DevTools → Console.
3. Connect Nightly. Confirm the dApp shows the multisig address connected.
4. Navigate to **Swap**, pick the input/output tokens, enter the amount.
5. Click **Swap**. The dApp will spin and then either hang or show an error.
6. In Console you'll see a `console.log` with the payload. Expected shape:

   ```json
   {
     "data": {
       "function": "0x...::stable_pool_scripts::swap_exact_in",
       "typeArguments": [
         "0x1::aptos_coin::AptosCoin",
         "<usdc-coin-type>",
         "<lp-coin-type>",
         "..."
       ],
       "functionArguments": ["100000000", "<min-out>"]
     }
   }
   ```

   The exact module name and number of type arguments vary by pool type
   (stable pool vs weighted pool, two-asset vs multi-asset). **Trust whatever
   the console shows** — it's exactly what Thala's frontend produced.

7. Copy the object. In your multisig dashboard, create a new proposal,
   pick the ABI builder, fill in the fields from the JSON. Set max gas to
   something generous for swaps (e.g. `100000`).
8. **Simulate.** If the simulation succeeds, save and share. If it fails:
   - Check whether the on-chain pool state has moved (slippage limits in
     `<min-out>` may have become unreachable). Re-capture from Thala with a
     looser slippage and try again.
   - See [simulation failures](#simulating-retrying-and-submitting) for how
     to tell temporary failures (oracle, slippage) from permanent ones
     (wrong arguments, no funds).

---

## Worked example: a PancakeSwap swap

Goal: swap APT for USDT on `aptos.pancakeswap.finance`.

1. Same Nightly setup as above.
2. Open the dApp, open DevTools → Console, connect.
3. Set up the swap and click **Swap**. The dApp will fail to submit.
4. Console will show something like:

   ```json
   {
     "data": {
       "function": "0xc7efb40...::router::swap_exact_input",
       "typeArguments": [
         "0x1::aptos_coin::AptosCoin",
         "<usdt-coin-type>"
       ],
       "functionArguments": ["100000000", "9800000"]
     }
   }
   ```

   PancakeSwap's router functions are simpler — usually two type arguments
   (in, out) and two function arguments (amount in, min amount out).

5. Copy → proposal → ABI builder → fill → simulate → save → share.

> **Coin types are case-sensitive and version-sensitive.** Don't substitute
> `USDC` for `USDt` etc. Use the exact string from the console.

---

## Manual fallback: building a payload from scratch

If a dApp won't connect to Nightly (rare but happens), you'll need to
reconstruct the call manually. You need three things:

1. **The fully qualified function name** — `0xMODULE::module_name::function_name`
2. **Type arguments** — usually coin types like `0x1::aptos_coin::AptosCoin`
3. **Function arguments** — in the correct order and BCS-compatible form
   (`u64` as a decimal string, `address` as `0x...`, `bool` as `true`/`false`,
   `vector<u8>` as `0xhex`).

Sources, in order of reliability:

- **The contract source** — many Aptos protocols publish their Move on GitHub.
  Search for the function name.
- **The Aptos explorer ABI viewer** — paste the module address into
  [explorer.aptoslabs.com](https://explorer.aptoslabs.com), open the
  *Modules* tab, find the function in the ABI. This gives you the signature
  authoritatively.
- **A past on-chain transaction by another user** — explorer → search the
  function name → look at the *Payload* of a real transaction. Copy the type
  args and use it as a template.
- **Protocol docs / SDKs** — most DEXes publish a JS SDK that wraps these
  calls; reading its source reveals the exact module path and arg layout.

Once you have the three pieces, the ABI form in the dashboard takes the rest.

---

## Collecting signatures

After saving a proposal, you get a share link of the form:

```
http://localhost:3123/tx/<proposal-id>
```

Each co-signer opens that URL, connects their own Ed25519 wallet (the one
that holds *their* owner key), reviews the decoded transaction, and signs.
Their signature is recorded against their signer index.

### Signers without a browser wallet

If an owner only has a raw private key (not in any browser wallet), use the
**Offline signing** panel on the proposal page:

1. Export the unsigned transaction bytes from the panel (button: *Export
   for offline signing*).
2. Sign externally — for example, with `@aptos-labs/ts-sdk` in Node:

   ```ts
   import { Ed25519PrivateKey, Hex } from "@aptos-labs/ts-sdk";

   const priv = new Ed25519PrivateKey("0x<owner_priv_hex>");
   const txnBytes = Hex.fromHexString("0x<exported-bytes-hex>").toUint8Array();
   const signingMsg = /* SHA3-256 of "APTOS::RawTransaction" prefix + txnBytes */;
   const sig = priv.sign(signingMsg);
   console.log(sig.toString());
   ```

3. Paste the 64-byte hex signature plus the signer index back into the
   offline panel.

The app verifies your signature against the expected public key before
accepting it.

---

## Simulating, retrying, and submitting

Before submission, always **Simulate**. The button runs a dry execution
against the current chain state and tells you whether it would succeed.

### Reading simulation failures

When a simulation fails, the error message is usually one of:

| Error pattern | Likely cause | What to do |
|---|---|---|
| `Move abort in 0x...::oracle::...` or `STALE_PRICE` | An oracle hasn't refreshed recently; DEX/CDP needs fresh prices | **Temporary.** Wait 30–120 s, simulate again. May take several retries. |
| `INSUFFICIENT_BALANCE` / `EINSUFFICIENT_FUNDS` | Wallet doesn't have enough of the input token | **Permanent.** Fix the amount or top up the wallet. |
| `SLIPPAGE_EXCEEDED` / `min_amount_out` abort | Price moved between capture and simulation | **Temporary.** Re-capture from the dApp with the current price (or a higher slippage), build a new proposal. The old one is unrecoverable. |
| `SEQUENCE_NUMBER_TOO_OLD` | The wallet has sent another transaction since the proposal was built | **Permanent for this proposal.** Build a new proposal — it'll pick up the new sequence number automatically. |
| `OUT_OF_GAS` / `MAX_GAS_AMOUNT_EXCEEDED` | Gas budget too low | **Permanent for this proposal.** Rebuild with a higher `maxGasAmount` (e.g. 200000). |
| `OBJECT_NOT_FOUND` / missing resource | An address or coin type is wrong | **Permanent.** Check the captured payload — likely a type argument typo. |
| `Connection refused` / RPC 5xx | Aptos node temporarily unreachable | **Temporary.** Retry. |

A useful rule of thumb: anything mentioning **oracle, slippage, RPC, or
connection** is usually transient. Anything mentioning **balance, gas,
sequence number, or arguments** is usually permanent and requires rebuilding
the proposal.

### Submitting

Once enough signatures are collected (≥ threshold) and a fresh simulation
passes, click **Submit**. The combined `TransactionAuthenticatorMultiEd25519`
goes straight to the Aptos node. The app polls for on-chain confirmation at
~5 s, ~10 s, and ~60 s after submission.

If the submitted transaction reverts on-chain (you got past simulation but
real execution failed), the proposal status moves to *failed* with the
reason. Most often this is a price-moved-since-simulation case; rebuild and
retry.

---

## Troubleshooting / FAQ

**My import says "no on-chain history found".**  
The wallet has never sent a transaction. Use *Manual import* instead and
provide all public keys + threshold.

**The derived address doesn't match my wallet address.**  
The key order is wrong, the threshold is wrong, or you're missing a key.
MultiEd25519 wallets often include extra "salt" public keys beyond the
human-owned ones — make sure you provide *all* of them.

**Nightly doesn't show the payload in the console.**  
Check that you're using Nightly in watch-only mode (not a single-key
wallet). Watch-only is what causes the signing flow to log+drop rather than
prompt for a signature. Confirm the active wallet in Nightly is the
multisig address, not a personal address.

**The dApp loads in the iframe browser but the proposal doesn't appear.**  
Some dApps call non-standard wallet methods. Open the iframe page's
DevTools — the proxy logs unsupported calls. Fall back to Nightly capture.

**My co-signer's wallet is rejected.**  
This app blocks keyless / OAuth wallets (Aptos Connect, Google, Apple)
because they use non-Ed25519 keys that can't sit in a MultiEd25519 key set.
Co-signers must use a standard Ed25519 wallet (Petra, Moveth, Rise, OKX,
…) or sign offline with their raw key.

**Simulation keeps failing with an oracle error even after waiting.**  
Some pools have multiple oracles; one might be stuck. Try waiting longer
(5–10 minutes) or use a different pool/path on the dApp.

**Can I edit a proposal after sharing the link?**  
No. The signed payload bytes are committed when the proposal is created.
Edits require building a new proposal and a new link.

---

## Future: a dedicated extension

The Nightly watch-only console-capture workflow is a workaround. A future
improvement is a dedicated browser extension that presents itself to dApps as
an Aptos-Wallet-Standard wallet, intercepts `signAndSubmitTransaction`
properly, and submits the captured payload directly to this app as a new
proposal — no manual copy/paste. The same approach also works for
`signMessage` and `signTransaction` flows.

Until that exists, Nightly + DevTools is the most reliable bridge.
