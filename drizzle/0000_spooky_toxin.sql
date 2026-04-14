CREATE TABLE `multisigs` (
	`id` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`public_keys` text NOT NULL,
	`threshold` integer NOT NULL,
	`network` text NOT NULL,
	`label` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`multisig_id` text NOT NULL,
	`description` text NOT NULL,
	`source` text NOT NULL,
	`source_dapp_url` text,
	`payload` text NOT NULL,
	`raw_transaction_bytes` text NOT NULL,
	`sequence_number` integer NOT NULL,
	`max_gas_amount` integer NOT NULL,
	`gas_unit_price` integer NOT NULL,
	`expiration_timestamp_secs` integer NOT NULL,
	`fee_payer_address` text,
	`fee_payer_signature` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`tx_hash` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`multisig_id`) REFERENCES `multisigs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `signer_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal_id` text NOT NULL,
	`signer_index` integer NOT NULL,
	`public_key` text NOT NULL,
	`response` text NOT NULL,
	`signature` text,
	`decline_reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`proposal_id`) REFERENCES `proposals`(`id`) ON UPDATE no action ON DELETE no action
);
