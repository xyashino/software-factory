PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_work_orders` (
	`order_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`plan_id` text,
	`parent_order_id` text,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`description` text NOT NULL,
	`line_name` text NOT NULL,
	`line_snapshot_json` text,
	`unavailable_line_factories_json` text NOT NULL,
	`priority` text NOT NULL,
	`base_branch` text NOT NULL,
	`base_commit_sha` text,
	`branch` text NOT NULL,
	`head_commit_sha` text,
	`stale_base` integer DEFAULT 0 NOT NULL,
	`state` text NOT NULL,
	`current_step_index` integer DEFAULT 0 NOT NULL,
	`pinned_factory_id` text,
	`worktree_resets` integer DEFAULT 0 NOT NULL,
	`mechanic_runs` integer DEFAULT 0 NOT NULL,
	`active_job_id` text,
	`active_cell_id` text,
	`epoch` integer DEFAULT 0 NOT NULL,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `order_plans`(`plan_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_order_id`) REFERENCES `work_orders`(`order_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pinned_factory_id`) REFERENCES `factories`(`factory_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_work_orders`("order_id", "project_id", "plan_id", "parent_order_id", "slug", "title", "type", "description", "line_name", "line_snapshot_json", "unavailable_line_factories_json", "priority", "base_branch", "base_commit_sha", "branch", "head_commit_sha", "stale_base", "state", "current_step_index", "pinned_factory_id", "worktree_resets", "mechanic_runs", "active_job_id", "active_cell_id", "epoch", "version", "created_at", "updated_at") SELECT "order_id", "project_id", "plan_id", "parent_order_id", "slug", "title", "type", "description", "line_name", "line_snapshot_json", '[]', "priority", "base_branch", "base_commit_sha", "branch", "head_commit_sha", "stale_base", "state", "current_step_index", "pinned_factory_id", "worktree_resets", "mechanic_runs", "active_job_id", "active_cell_id", "epoch", "version", "created_at", "updated_at" FROM `work_orders`;--> statement-breakpoint
DROP TABLE `work_orders`;--> statement-breakpoint
ALTER TABLE `__new_work_orders` RENAME TO `work_orders`;--> statement-breakpoint
CREATE UNIQUE INDEX `work_orders_active_job_id_unique` ON `work_orders` (`active_job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_orders_one_active_per_cell` ON `work_orders` (`active_cell_id`) WHERE "work_orders"."active_cell_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_safe_tokens` (
	`token_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`scopes_json` text NOT NULL,
	`factory_id` text,
	`rotated_from_id` text,
	`expires_at` integer,
	`revoked_at` integer,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`factory_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rotated_from_id`) REFERENCES `safe_tokens`(`token_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_safe_tokens`("token_id", "token_hash", "prefix", "kind", "name", "scopes_json", "factory_id", "rotated_from_id", "expires_at", "revoked_at", "last_used_at", "created_at") SELECT "token_id", "token_hash", "prefix", "kind", "name", "scopes_json", "factory_id", "rotated_from_id", "expires_at", "revoked_at", "last_used_at", "created_at" FROM `safe_tokens` WHERE `kind` NOT IN ('cell_join', 'cell_session');--> statement-breakpoint
DROP TABLE `safe_tokens`;--> statement-breakpoint
ALTER TABLE `__new_safe_tokens` RENAME TO `safe_tokens`;--> statement-breakpoint
CREATE UNIQUE INDEX `safe_tokens_token_hash_unique` ON `safe_tokens` (`token_hash`);--> statement-breakpoint
DROP INDEX `idx_jobs_one_active_per_cell`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_jobs_one_active_per_cell` ON `jobs` (`claimed_by_cell_id`) WHERE "jobs"."claimed_by_cell_id" IS NOT NULL AND "jobs"."status" IN ('claimed', 'running');--> statement-breakpoint
ALTER TABLE `jobs` DROP COLUMN `cell_id`;--> statement-breakpoint
DROP TABLE `cells`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
