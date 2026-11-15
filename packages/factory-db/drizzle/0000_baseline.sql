CREATE TABLE `blobs` (
	`ref` text PRIMARY KEY NOT NULL,
	`size` integer NOT NULL,
	`encoding` text NOT NULL,
	`content` blob NOT NULL,
	`media_type` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cells` (
	`cell_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`joined_with` text,
	`joined_at` integer NOT NULL,
	`revoked_at` integer,
	`last_seen_at` integer,
	`info` text,
	FOREIGN KEY (`joined_with`) REFERENCES `join_tokens`(`join_token_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `commands` (
	`command_id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`first_seq` integer,
	`last_seq` integer,
	`response` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`global_seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` text NOT NULL,
	`seq` integer NOT NULL,
	`at` integer NOT NULL,
	`actor` text NOT NULL,
	`command_id` text NOT NULL,
	`epoch` integer,
	`schema_version` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_type` ON `events` (`type`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_order_seq` ON `events` (`order_id`,`seq`);--> statement-breakpoint
CREATE TABLE `intake` (
	`project_id` text NOT NULL,
	`todo_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`seen_commit` text NOT NULL,
	`diagnostic` text,
	PRIMARY KEY(`project_id`, `todo_id`)
);
--> statement-breakpoint
CREATE TABLE `join_tokens` (
	`join_token_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`command_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `join_tokens_token_hash_unique` ON `join_tokens` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `join_tokens_command_id` ON `join_tokens` (`command_id`);--> statement-breakpoint
CREATE TABLE `leases` (
	`order_id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`cell_id` text NOT NULL,
	`epoch` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`cell_id`) REFERENCES `cells`(`cell_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leases_job_id_unique` ON `leases` (`job_id`);--> statement-breakpoint
CREATE INDEX `leases_expiry` ON `leases` (`expires_at`);--> statement-breakpoint
CREATE TABLE `orders` (
	`order_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`todo_id` text NOT NULL,
	`title` text NOT NULL,
	`line` text NOT NULL,
	`priority` text NOT NULL,
	`depends_on` text NOT NULL,
	`last_seq` integer NOT NULL,
	`status` text NOT NULL,
	`holder` text NOT NULL,
	`next_kind` text NOT NULL,
	`job_kind` text,
	`runner` text,
	`required_capabilities` text DEFAULT '[]' NOT NULL,
	`station_id` text,
	`station_index` integer,
	`progressed` integer NOT NULL,
	`resumed` integer NOT NULL,
	`last_cell_id` text,
	`avoid_cells` text DEFAULT '[]' NOT NULL,
	`andon_reason` text,
	`pr_url` text,
	`pr_state` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`plan` text,
	`base_branch` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`project_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `orders_plan` ON `orders` (`project_id`,`plan`);--> statement-breakpoint
CREATE INDEX `orders_queue` ON `orders` (`holder`,`next_kind`,`priority`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_project_todo` ON `orders` (`project_id`,`todo_id`);--> statement-breakpoint
CREATE TABLE `plans` (
	`plan_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`slug` text NOT NULL,
	`branch` text NOT NULL,
	`base_branch` text NOT NULL,
	`last_seq` integer NOT NULL,
	`phase` text NOT NULL,
	`holder` text NOT NULL,
	`next_kind` text NOT NULL,
	`job_kind` text,
	`members` text DEFAULT '[]' NOT NULL,
	`branch_commit` text,
	`pr_url` text,
	`pr_state` text,
	`last_cell_id` text,
	`avoid_cells` text DEFAULT '[]' NOT NULL,
	`andon_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`project_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `plans_queue` ON `plans` (`holder`,`next_kind`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `plans_project_slug` ON `plans` (`project_id`,`slug`);--> statement-breakpoint
CREATE TABLE `projects` (
	`project_id` text PRIMARY KEY NOT NULL,
	`repo_url` text NOT NULL,
	`base_branch` text DEFAULT 'main' NOT NULL,
	`max_running` integer DEFAULT 2 NOT NULL,
	`dep_policy` text DEFAULT 'delivered' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `signals` (
	`signal_id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`acked_at` integer
);
--> statement-breakpoint
CREATE TABLE `supervisor_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
