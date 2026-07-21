# Installation (VM)

Step-by-step guide to install every required tool and run **Aptos Multisig UI** on a fresh Linux VM. Commands below target **Ubuntu / Debian**. Other distros work the same way if you install the equivalent packages.

Follow the sections **in order**. Later steps depend on earlier tools.

---

## What you will install (in order)

| # | Tool | Why it is needed |
|---|------|------------------|
| 1 | System packages (`curl`, `git`, `ca-certificates`, `build-essential`, `python3`) | Clone the repo; compile native Node addons (`better-sqlite3`) |
| 2 | Node.js **24+** | Runtime for Next.js and tooling (`engines.node`) |
| 3 | pnpm **11.13.0+** | Package manager (`packageManager` / `engines.pnpm`) |
| 4 | Repository clone | Application source |
| 5 | App dependencies + SQLite schema | `pnpm install`, rebuild `better-sqlite3`, `drizzle-kit push` |
| 6 | **(Production)** pm2 | Keep `pnpm start` running across logouts/reboots |
| 7 | **(Production, HTTPS)** Caddy | TLS termination and reverse proxy (optional; needs a public `DOMAIN`) |

**Client-side (not on the VM):** a browser with the [Petra wallet](https://petra.app) extension to connect and sign.

Optional helper: [mise](https://mise.jdx.dev) can install Node and pnpm from `mise.toml` instead of steps 2–3 manually.

---

## 1. System packages

```bash
sudo apt-get update
sudo apt-get install -y \
  curl \
  ca-certificates \
  git \
  build-essential \
  python3
```

- `build-essential` provides `gcc`, `g++`, and `make` (required to compile `better-sqlite3`).
- `python3` is used by `node-gyp` during native module builds.
- `git` and `curl` are used to clone the repo and install Node/pnpm.

Verify:

```bash
git --version
curl --version
gcc --version
python3 --version
```

---

## 2. Node.js 24+

This project requires **Node.js ≥ 24**. Install via NodeSource (recommended on a VM):

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Verify:

```bash
node -v   # must be v24.x or newer
npm -v
```

### Alternative: mise

If you prefer version managers:

```bash
curl https://mise.run | sh
# restart the shell or follow the installer’s PATH instructions
cd /path/to/aptos-multisig-ui   # after cloning (step 4)
mise install                    # installs node=24 and pnpm=11.13.0 from mise.toml
```

If you use `mise install`, you can skip the separate pnpm install in step 3.

---

## 3. pnpm 11.13.0+

Skip this step if you already ran `mise install` (step 2 alternative).

```bash
sudo corepack enable
sudo corepack prepare pnpm@11.13.0 --activate
```

Or:

```bash
npm install -g pnpm@11.13.0
```

Verify:

```bash
pnpm -v   # must be 11.x (11.13.0 or newer)
```

---

## 4. Clone the repository

```bash
git clone https://github.com/gregnazario/aptos-multisig-ui.git
cd aptos-multisig-ui
```

Use your fork URL if applicable.

---

## 5. Configure environment

```bash
cp .env.local.example .env.local
```

Edit `.env.local` before first run. Minimum for a working local/dev VM:

```env
DATABASE_URL=file:local.db
JWT_SECRET=dev-secret-change-in-production
PORT=3000
```

For production, set a strong random `JWT_SECRET` (required — the app throws on startup without it in production).

Optional production HTTPS (Caddy):

```env
DOMAIN=multisig.example.com
PORT=3000
```

Leave `DOMAIN` unset for HTTP-only on `PORT` (default `3000`). See `.env.local.example` for gas station, admin addresses, and split-deployment variables.

---

## 6. Install app dependencies and database schema

Still inside the repo root:

```bash
# Install JS dependencies
pnpm install

# Rebuild the native SQLite binding (required on a fresh VM)
pnpm rebuild better-sqlite3

# Create / sync the SQLite schema
pnpm drizzle-kit push
```

Or use the Makefile shorthand:

```bash
make install    # pnpm install + rebuild better-sqlite3
make db-push    # pnpm drizzle-kit push
```

---

## 7. Run the app

### Development (hot reload)

```bash
pnpm dev
# or: make dev
```

Open [http://localhost:3123](http://localhost:3123). The dev server **always** uses port **3123** (ignores `PORT`).

Connect Petra (set the wallet network to Devnet for testing).

Useful checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

### Production on the VM (recommended path)

Install **pm2** so the process survives SSH disconnects:

```bash
sudo npm install -g pm2
```

Then either:

```bash
make deploy
```

which runs, in order: `install` → `build` → `db-push` → `restart` (pm2) → `caddy` (skipped if `DOMAIN` is unset),

or step by step:

```bash
make install
make build
make db-push
make restart    # pm2 restart/start process name "multisig"
```

The production server listens on `PORT` from `.env.local` (default **3000**).

pm2 helpers:

```bash
make logs       # pm2 logs multisig
make status     # pm2 status
pm2 save
pm2 startup     # print/enable boot persistence; follow the command it prints
```

### Optional HTTPS with Caddy

1. Point DNS `A`/`AAAA` for your domain at the VM’s public IP.
2. Open ports **80** and **443** in the firewall/security group.
3. Set `DOMAIN` (and `PORT` if not 3000) in `.env.local`.
4. Install Caddy ([official install docs](https://caddyserver.com/docs/install)), for example on Ubuntu:

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update
sudo apt-get install -y caddy
```

5. Start or reload the included config:

```bash
make caddy       # start/reload; provisions Let’s Encrypt for DOMAIN
make caddy-stop  # stop Caddy
```

`make deploy` runs `make caddy` automatically when `DOMAIN` is set. Binding 80/443 needs appropriate privileges (the official Caddy package typically grants the needed capabilities).

---

## Quick checklist (copy/paste order)

```bash
# 1. System packages
sudo apt-get update
sudo apt-get install -y curl ca-certificates git build-essential python3

# 2. Node.js 24
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. pnpm
sudo corepack enable
sudo corepack prepare pnpm@11.13.0 --activate

# 4. Clone
git clone https://github.com/gregnazario/aptos-multisig-ui.git
cd aptos-multisig-ui

# 5. Env
cp .env.local.example .env.local
# edit JWT_SECRET (and DOMAIN for HTTPS)

# 6. App deps + DB
pnpm install
pnpm rebuild better-sqlite3
pnpm drizzle-kit push

# 7a. Dev
pnpm dev

# 7b. Production (instead of 7a)
sudo npm install -g pm2
make deploy
# optional: install Caddy, set DOMAIN, then make caddy / make deploy
```

---

## Updating an existing VM deploy

```bash
cd aptos-multisig-ui
make update     # git pull + full make deploy
```

Or:

```bash
git pull
make deploy
```

---

## Troubleshooting

| Symptom | Likely fix |
|---------|------------|
| `better-sqlite3` / `node-gyp` build fails | Install `build-essential` and `python3`, then `pnpm rebuild better-sqlite3` |
| Wrong Node version | Install Node 24+; check `node -v` |
| `pnpm: command not found` | Re-run step 3 (corepack or `npm i -g pnpm`) |
| App crashes on start in production | Set a non-empty `JWT_SECRET` in `.env.local` |
| Port already in use | Change `PORT` for production, or stop the conflicting process; dev is fixed at 3123 |
| Caddy skipped / no HTTPS | Set `DOMAIN` in `.env.local`, install Caddy, open 80/443, ensure DNS points at the VM |
| pm2 process missing after reboot | Run `pm2 save` and `pm2 startup` once |

---

## Related docs

- [README.md](./README.md) — features, usage, project structure
- [`.env.local.example`](./.env.local.example) — full environment variable reference
- [Makefile](./Makefile) — `install`, `deploy`, `caddy`, `db-push`, and other targets
- [MSAFE_COMPATIBILITY.md](./MSAFE_COMPATIBILITY.md) — deeper ops and compatibility notes
