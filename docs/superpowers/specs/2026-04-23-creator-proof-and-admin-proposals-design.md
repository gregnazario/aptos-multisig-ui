# Creator Proof & Admin Allowlist for Proposals

Date: 2026-04-23
Status: Draft — awaiting implementation

## Summary

Every DB-backed proposal carries a verifiable Ed25519 signature binding its creator to the exact transaction content (the "creator proof"). The creator must be either (a) a public key in the target multisig's signer list, or (b) a public key whose derived Aptos account address is in a server-configured admin address allowlist (`APTOS_ADMIN_ADDRESSES`). This decouples proposal authorship from signer membership while keeping authorship cryptographically provable.

## Goals

- Let designated admins create proposals for multisigs they do not belong to.
- Every newly-created proposal has a signature anyone can verify against its `rawTransactionBytes` and creator public key.
- The proposal view shows creator identity, a role badge (Signer / Admin), and a proof-verify affordance.
- Admin identities are managed server-side (env var), not through the UI.

## Non-goals

- No change to URL-based proposals (`/propose` → URL-encoded tx). That flow is already open and doesn't go through the DB.
- Admin signatures are **not** signer votes and never count toward the multisig threshold.
- No retroactive signatures for pre-existing DB rows.

## Design

### Canonical signed message

Creators sign a domain-separated message to guarantee their signature can never be confused with a signer vote on the transaction itself:

```
"APTOS_MULTISIG_UI::PROPOSE::" + hex(sha256(rawTransactionBytes))
```

Encoded as UTF-8 bytes. A helper `buildProposalProofMessage(rawTxBytes: Uint8Array): Uint8Array` lives in `src/lib/auth/proposal-proof.ts` and is shared between client and server.

### Admin allowlist

- Env var `APTOS_ADMIN_ADDRESSES` — comma-separated Aptos account addresses (0x-prefixed or bare). Addresses are the canonical operator identifier and match what users paste from explorers/wallets.
- Parsed into a normalized `Set<string>` (lowercase, 0x-stripped, 64-char padded) on first access.
- New module `src/lib/auth/admin.ts` exports:
  - `deriveAddressFromPublicKey(pk: string): string` — Ed25519 public key → Aptos account address via the standard authentication-key derivation (`sha3_256(pubkey || 0x00)`) using `@aptos-labs/ts-sdk`'s `Ed25519PublicKey.authKey().derivedAddress()`.
  - `isAdmin(publicKey: string): boolean` — derives the address from `publicKey` and checks membership in the normalized admin set.
- Empty/unset value ⇒ no admins; logs a one-time warn in non-production, no throw.
- Note: signer-membership matching for a multisig still happens by **public key** (not address), because MultiEd25519 multisigs are composed of specific aggregated pubkeys. Admin identity is address-based; signer identity is pubkey-based. This split is intentional — admin keys can be rotated via auth-key rotation without touching the env var, while multisig signer pubkeys are fixed by the on-chain aggregate.

### Data model

New nullable columns on the `proposals` table:

- `creator_public_key TEXT` — 0x-prefixed 32-byte Ed25519 public key hex.
- `creator_signature TEXT` — 0x-prefixed 64-byte Ed25519 signature hex.

The existing `created_by` column stays and is populated with the same value as `creator_public_key` for new rows. Old rows keep whatever they had and the UI shows them as "Unverified creator".

Drizzle migration adds the two columns. No backfill.

### API changes

#### `POST /api/multisig/[address]/proposals`

- JWT session is no longer required — the creator proof is the authentication.
- Request body gains:
  - `creatorPublicKey: string`
  - `creatorSignature: string`
- Server flow:
  1. Load multisig by `address` + `network`.
  2. Build the transaction (existing logic) to obtain `rawTransactionBytes`.
  3. Compute the canonical message and verify `creatorSignature` against `creatorPublicKey` via Ed25519.
  4. Authorize: `creatorPublicKey` is in `multisig.publicKeys` **or** `isAdmin(creatorPublicKey)` (i.e., the derived address is in `APTOS_ADMIN_ADDRESSES`).
  5. Persist the proposal with `creator_public_key`, `creator_signature`, and `created_by = creatorPublicKey`.
- The optional "first signer signature" body field is still supported, but only when the creator is a signer (stores a `signerResponses` row as today).

#### `GET /api/proposal/[id]`

- Response includes `creatorPublicKey`, `creatorSignature`, `creatorAddress` (server-derived from the public key), `rawTransactionBytes` (rawTx already present), and a computed `creatorRole: "signer" | "admin" | "unverified"`.

### Client changes

`src/app/propose/page.tsx` (and any other DB-backed create callsite discovered during planning):

1. POST to `/api/multisig/build-tx` to get `rawTransactionBytes` (already used).
2. Build the canonical message via the shared helper; sign it with the wallet (`adapter.signMessage({ message, nonce: "" })`).
3. Extract the raw 64-byte Ed25519 signature from the adapter response (same pattern as the existing `signTransaction` → raw-sig extraction in `proposal-view.tsx`).
4. POST `{ ..., creatorPublicKey, creatorSignature }` to `/api/multisig/[address]/proposals`.

`src/components/proposal-view.tsx`:

- New "Proposed by" row: shortened **account address** (derived from the stored `creatorPublicKey`) with tooltip showing both the address and the raw public key, plus a role badge:
  - "Signer" (neutral)
  - "Admin" (amber/yellow — visually distinct so signers notice admin-created items)
  - "Unverified" (muted — only for legacy rows without a stored proof)
- "Verify proof" button → runs `Ed25519PublicKey.verifySignature` (from `@aptos-labs/ts-sdk`) client-side against the stored public key and signature and toggles ✓ Valid / ✗ Invalid.

### Authorization model

| Action          | Auth requirement                                                    |
| --------------- | ------------------------------------------------------------------- |
| Create proposal | Valid creator proof + (signer OR admin).                            |
| Sign / Decline  | Existing JWT session scoped to a signer (unchanged).                |
| Cancel          | Existing JWT session scoped to a signer (unchanged).                |
| Submit          | Unchanged (currently open).                                         |

### Error handling

- Missing `creatorPublicKey`/`creatorSignature` → 400 `"Creator proof required"`.
- Malformed hex → 400 `"Invalid proof encoding"`.
- Signature fails verify → 403 `"Creator proof did not verify"`.
- Creator neither signer nor admin → 403 `"Creator not authorized for this multisig"`.

### Testing

- **Unit**
  - Admin allowlist normalization (0x prefix, case, padding).
  - `deriveAddressFromPublicKey` matches known pubkey→address vectors from the Aptos SDK.
  - Canonical-message builder is byte-for-byte deterministic for fixed input.
  - Ed25519 verify path: valid signer, valid admin (matched via derived address), invalid signature, wrong public key, neither role.
- **Integration**
  - Create as signer (stored, role=signer).
  - Create as admin (stored, role=admin).
  - Create as stranger (rejected).
  - Tampered signature (rejected).
  - Round-trip: create → GET → client verify succeeds.

## Risks & mitigations

- **Admin key compromise** → full treasury-proposal access. Mitigation: small rotatable env-var list; admin badge in UI so signers are aware when voting.
- **Replay to signer-vote** → mitigated by domain separation (signature over a message that is never the tx body hash used in any signing aggregation).
- **Old rows without proofs** → displayed as "Unverified creator" rather than treated as valid. Purely cosmetic; they still function.

## Open questions resolved

- Signer-created proposals must also carry a creator proof → **yes** (user: "all proposals").
- Admin list empty in dev → warn once, don't throw → **yes**.

## Out of scope (future work)

- Per-multisig admin allowlists stored in DB.
- Signed "cancel by admin" or "submit by admin" flows (today admin can only propose).
- UI for rotating the admin list (stays env-var-managed).
