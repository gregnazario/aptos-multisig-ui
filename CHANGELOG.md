# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-08-26

### Added

- Admin page listing every registered multisig on the current network
- Indexer-backed coin and fungible-asset balances on the multisig dashboard, with transfer links into the propose flow
- Dark mode toggle, footer links, and favicon
- Caddy HTTPS reverse proxy driven by `DOMAIN` / `PORT` in `.env.local`
- `INSTALLATION.md` with ordered VM setup and production deploy (pm2 / Caddy)
- Example env file tracked in git (`.env.local.example`)
- SHA-pinned GitHub Actions for CI and GitHub Pages

### Changed

- Pages and views are mobile-friendly
- Production dependencies updated, including Next.js

### Security

- Dependency updates to clear pnpm audit findings

## [1.0.0] - 2026-05-13

Initial GitHub release of the MultiEd25519 multisig UI, with documentation and exact-version dependency pins.

[1.1.0]: https://github.com/gregnazario/aptos-multisig-ui/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/gregnazario/aptos-multisig-ui/releases/tag/v1.0.0
