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
