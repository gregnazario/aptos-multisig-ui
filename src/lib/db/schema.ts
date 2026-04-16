import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  failureReason: text("failure_reason"),
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

export const multisigSetups = sqliteTable("multisig_setups", {
  id: text("id").primaryKey(), // UUID, used in shareable link
  addresses: text("addresses").notNull(), // JSON array of signer addresses
  threshold: integer("threshold").notNull(),
  network: text("network").notNull(),
  label: text("label"),
  createdBy: text("created_by").notNull(), // address of creator
  status: text("status").notNull().default("pending"), // pending | complete
  multisigId: text("multisig_id"), // FK set when complete, links to created multisig
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const setupVerifications = sqliteTable("setup_verifications", {
  id: text("id").primaryKey(), // UUID
  setupId: text("setup_id")
    .notNull()
    .references(() => multisigSetups.id),
  address: text("address").notNull(), // the signer address that was verified
  publicKey: text("public_key").notNull(), // extracted Ed25519 public key
  signature: text("signature").notNull(), // the verification signature (proof)
  fullMessage: text("full_message").notNull(), // the full signed message
  nonce: text("nonce").notNull(), // nonce used in the verification
  verifiedAt: integer("verified_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
