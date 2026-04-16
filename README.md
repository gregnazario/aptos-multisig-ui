# Aptos Multisig UI

A web application for managing **MultiEd25519** multisig treasury accounts on Aptos. Create K-of-N multisigs, propose arbitrary transactions, collect Ed25519 signatures offchain via shareable links, and submit combined multi-signed transactions — with an optional dApp browser and gas station.

## How It Works

Aptos natively supports **MultiEd25519** authentication at the protocol level — no smart contracts needed. An account controlled by N Ed25519 public keys requires K signatures to authorize any transaction. This app coordinates that signature collection offchain:

1. **Create a multisig** — specify signer addresses and threshold (e.g., 2-of-3). Each signer verifies ownership by connecting their wallet.
2. **Propose a transaction** — build an arbitrary entry function call or capture one from a dApp via the iframe browser.
3. **Collect signatures** — share the proposal link. Each signer opens it, reviews the transaction, and signs with their wallet.
4. **Submit** — once threshold is met, anyone can submit the combined MultiEd25519 signature to the chain.

## Features

- **Arbitrary K-of-N** threshold (up to 32 signers)
- **Address-based creation** — enter signer addresses, not public keys. Keys are extracted from wallet signatures.
- **Shareable links** for both multisig setup verification and transaction signing
- **Arbitrary entry function calls** — call any Move function, not just APT transfers
- **dApp browser** — embed dApps (e.g., Aries Markets) in an iframe with wallet injection, capture transactions as multisig proposals
- **Import from on-chain** — look up any existing MultiEd25519 account by address to extract its key configuration
- **Gas station** — optional fee payer support (manual or automated backend key)
- **Transaction status polling** — auto-checks on-chain confirmation at 5s, 10s, 60s after submission
- **Network support** — mainnet, testnet, devnet
- **Petra wallet** via the official `@aptos-labs/wallet-adapter-react` (AIP-62)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js](https://nextjs.org) 16 (App Router) |
| Database | SQLite via [Drizzle ORM](https://orm.drizzle.team) + [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) |
| Blockchain | [@aptos-labs/ts-sdk](https://github.com/aptos-labs/aptos-ts-sdk) |
| Wallet | [@aptos-labs/wallet-adapter-react](https://github.com/aptos-labs/aptos-wallet-adapter) |
| Styling | [Tailwind CSS](https://tailwindcss.com) v4 + [shadcn/ui](https://ui.shadcn.com) |
| Linting | [Biome](https://biomejs.dev) |

## Getting Started

### Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io)
- [Petra wallet](https://petra.app) browser extension

### Setup

```bash
# Install dependencies
pnpm install

# Rebuild native modules (better-sqlite3)
pnpm rebuild better-sqlite3

# Push database schema
pnpm drizzle-kit push

# Start dev server
pnpm dev
```

Open [http://localhost:3123](http://localhost:3123) and connect Petra (set to Devnet for testing).

### Environment Variables

Copy `.env.local.example` or create `.env.local`:

```env
# Database
DATABASE_URL=file:local.db

# Session signing
JWT_SECRET=dev-secret-change-in-production

# Gas Station (optional)
GAS_STATION_ENABLED=false
GAS_STATION_PRIVATE_KEY=
GAS_STATION_MAX_GAS_PER_TX=10000
GAS_STATION_NETWORKS=devnet,testnet

# Split deployment (optional) — see "Split Deployment" section below
# BACKEND_URL=https://api.example.com
# CORS_ORIGIN=https://app.example.com
```

## Usage

### Create a Multisig

1. Connect your Petra wallet
2. Go to **Create Multisig**
3. Choose number of signers and threshold (e.g., 2-of-3)
4. Enter each signer's Aptos address
5. Sign to verify your identity — get a shareable setup link
6. Other signers open the link and verify with their wallets
7. Once all signers verified, the multisig address is derived and registered

### Import an Existing Multisig

Go to **Import Multisig** → **Lookup by Address**. Enter the multisig's address — if it has any on-chain transactions, the public keys and threshold are extracted automatically from the authenticator.

### Propose a Transaction

From the multisig dashboard, click **New Proposal**:

- **Module Address** — e.g., `0x1`
- **Module Name** — e.g., `aptos_account`
- **Function** — e.g., `transfer`
- **Arguments** — e.g., `0xrecipient, 100000000`

Or use the **dApp Browser** to interact with protocols like Aries Markets directly — transactions are captured as multisig proposals.

### Sign and Submit

1. Share the proposal link with co-signers
2. Each signer connects their wallet, reviews, and signs
3. Once threshold is met, click **Submit Transaction**
4. Status auto-updates via on-chain polling

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── dapp-proxy/        # Reverse proxy for dApp browser iframe
│   │   ├── gas-station/       # Fee payer sponsorship
│   │   ├── multisig/          # Registration, lookup, setup, verification
│   │   ├── proposal/          # Sign, decline, submit, cancel, status check
│   │   └── verify/            # Wallet signature challenge (JWT)
│   ├── multisig/
│   │   ├── [address]/         # Dashboard, propose, dApp browser
│   │   ├── create/            # Guided creation flow
│   │   ├── import/            # Import via address lookup or manual keys
│   │   └── setup/[id]/        # Shareable signer verification page
│   └── tx/[proposalId]/       # Shareable signing page
├── components/                 # React components
├── lib/
│   ├── aptos/                  # SDK utilities (address derivation, tx building, submission)
│   ├── auth/                   # JWT session management
│   ├── db/                     # Drizzle schema and connection
│   └── gas-station/            # Fee payer configuration and signing
```

## dApp Browser

The dApp browser embeds third-party dApps in an iframe via a server-side reverse proxy that:

1. Fetches the dApp's HTML and injects a wallet adapter script
2. Registers as an AIP-62 wallet via the Wallet Standard protocol
3. Overrides `window.aptos` for legacy compatibility
4. Intercepts `fetch()` and `XMLHttpRequest` to redirect relative URLs to the dApp's origin
5. Captures `signAndSubmitTransaction` calls and routes them through the multisig proposal flow

**Known limitation:** Some dApps use third-party APIs (Alchemy, CoinGecko) that whitelist by origin. These APIs will reject requests from `localhost` during development. Deploy to a real domain for full functionality.

## Gas Station

Configure a backend Ed25519 key as an automated fee payer:

```env
GAS_STATION_ENABLED=true
GAS_STATION_PRIVATE_KEY=0x...hex...
GAS_STATION_MAX_GAS_PER_TX=10000
GAS_STATION_NETWORKS=devnet,testnet
```

When a proposal specifies the gas station's address as the fee payer, it auto-signs during submission.

## Split Deployment

The frontend and backend can run on separate machines. The same Next.js app is deployed to both — the only difference is environment variables.

### Single machine (default)

Everything runs together. No extra configuration needed.

### Split: Frontend + Backend

**Backend (VPS with SQLite):**
```env
DATABASE_URL=file:/data/multisig.db
JWT_SECRET=your-production-secret
CORS_ORIGIN=https://app.example.com
```

```bash
pnpm build && pnpm start
```

**Frontend (Vercel or another host):**
```env
BACKEND_URL=https://api.example.com
JWT_SECRET=your-production-secret  # must match backend
```

```bash
pnpm build && pnpm start
```

When `BACKEND_URL` is set, Next.js rewrites proxy all `/api/*` requests to the backend server. The frontend needs no database. When `CORS_ORIGIN` is set on the backend, middleware adds the appropriate CORS headers.

### URL mode (no backend at all)

With URL-based proposals, the frontend can work entirely without a backend for the core signing flow. The only server-side call is `/api/multisig/build-tx` to serialize the transaction (which only needs an Aptos RPC connection, no database).

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server (port 3123) |
| `pnpm build` | Production build |
| `pnpm start` | Start production server |
| `pnpm test` | Run tests |
| `pnpm lint` | Check lint and formatting |
| `pnpm lint:fix` | Auto-fix lint issues |
| `pnpm format` | Format all source files |
| `pnpm drizzle-kit push` | Push schema to database |
| `pnpm drizzle-kit studio` | Open Drizzle Studio |
