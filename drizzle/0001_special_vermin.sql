CREATE TABLE `multisig_setups` (
	`id` text PRIMARY KEY NOT NULL,
	`addresses` text NOT NULL,
	`threshold` integer NOT NULL,
	`network` text NOT NULL,
	`label` text,
	`created_by` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`multisig_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `setup_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`setup_id` text NOT NULL,
	`address` text NOT NULL,
	`public_key` text NOT NULL,
	`signature` text NOT NULL,
	`full_message` text NOT NULL,
	`nonce` text NOT NULL,
	`verified_at` integer NOT NULL,
	FOREIGN KEY (`setup_id`) REFERENCES `multisig_setups`(`id`) ON UPDATE no action ON DELETE no action
);
