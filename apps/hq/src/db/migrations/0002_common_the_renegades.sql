CREATE TABLE `factories` (
	`factory_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `safe_tokens` ADD `factory_id` text REFERENCES factories(factory_id);