CREATE TABLE `cells` (
	`slot_id` text PRIMARY KEY NOT NULL,
	`cell_id` text,
	`factory_id` text NOT NULL,
	`repo_root` text NOT NULL,
	`name` text NOT NULL,
	`desired_state` text NOT NULL,
	`runtime_status` text NOT NULL,
	`pid` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`factory_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cells_repo_root_name` ON `cells` (`repo_root`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cells_factory_cell_id` ON `cells` (`factory_id`,`cell_id`) WHERE "cells"."cell_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `factories` (
	`factory_id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_factories_one_default` ON `factories` (`is_default`) WHERE "factories"."is_default" = 1;--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
