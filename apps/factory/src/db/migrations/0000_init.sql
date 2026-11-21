CREATE TABLE `cells` (
	`cell_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`project_id` text NOT NULL,
	`allowed_lines_json` text NOT NULL,
	`status` text NOT NULL,
	`runners_json` text NOT NULL,
	`local_worktrees_json` text NOT NULL,
	`active_job_id` text,
	`last_heartbeat_at` integer,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`project_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `incidents` (
	`incident_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`order_id` text NOT NULL,
	`failed_step_id` text,
	`failed_job_id` text,
	`reason` text NOT NULL,
	`detail` text NOT NULL,
	`status` text NOT NULL,
	`triage_owner` text NOT NULL,
	`diagnosis` text,
	`resolution_action` text,
	`resolved_by` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `work_orders`(`order_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`failed_step_id`) REFERENCES `order_steps`(`step_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`failed_job_id`) REFERENCES `jobs`(`job_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`job_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`plan_id` text,
	`order_id` text,
	`step_id` text,
	`incident_id` text,
	`line_name` text,
	`kind` text NOT NULL,
	`workspace_mode` text NOT NULL,
	`status` text NOT NULL,
	`repo_url` text NOT NULL,
	`base_branch` text NOT NULL,
	`base_commit_sha` text,
	`target_branch` text NOT NULL,
	`expected_prior_steps_json` text NOT NULL,
	`payload_json` text NOT NULL,
	`cell_id` text,
	`epoch` integer DEFAULT 0 NOT NULL,
	`lease_expires_at` integer,
	`result_commit_sha` text,
	`result_json` text,
	`error_detail` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `order_plans`(`plan_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `work_orders`(`order_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`step_id`) REFERENCES `order_steps`(`step_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`incident_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cell_id`) REFERENCES `cells`(`cell_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_jobs_one_active_per_order` ON `jobs` (`order_id`) WHERE "jobs"."order_id" IS NOT NULL AND "jobs"."status" IN ('claimed', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX `idx_jobs_one_active_per_cell` ON `jobs` (`cell_id`) WHERE "jobs"."cell_id" IS NOT NULL AND "jobs"."status" IN ('claimed', 'running');--> statement-breakpoint
CREATE TABLE `order_steps` (
	`step_id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`station_id` text NOT NULL,
	`kind` text NOT NULL,
	`runner` text,
	`config_json` text NOT NULL,
	`required_files_json` text NOT NULL,
	`produced_files_json` text NOT NULL,
	`state` text NOT NULL,
	`attempts_used` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer NOT NULL,
	`on_fail_retry_station_id` text,
	`last_commit_sha` text,
	`last_output_json` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `work_orders`(`order_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `work_orders` (
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
	`unavailable_line_cells_json` text NOT NULL,
	`priority` text NOT NULL,
	`base_branch` text NOT NULL,
	`base_commit_sha` text,
	`branch` text NOT NULL,
	`head_commit_sha` text,
	`stale_base` integer DEFAULT 0 NOT NULL,
	`state` text NOT NULL,
	`current_step_index` integer DEFAULT 0 NOT NULL,
	`pinned_cell_id` text,
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
	FOREIGN KEY (`pinned_cell_id`) REFERENCES `cells`(`cell_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_orders_active_job_id_unique` ON `work_orders` (`active_job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_orders_one_active_per_cell` ON `work_orders` (`active_cell_id`) WHERE "work_orders"."active_cell_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `order_plans` (
	`plan_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`base_branch` text NOT NULL,
	`branch` text NOT NULL,
	`branch_commit_sha` text,
	`state` text NOT NULL,
	`failure_detail` text,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`project_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`project_id` text PRIMARY KEY NOT NULL,
	`repo_url` text NOT NULL,
	`default_base_branch` text NOT NULL,
	`max_running` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `safe_tokens` (
	`token_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`scopes_json` text NOT NULL,
	`cell_id` text,
	`rotated_from_id` text,
	`expires_at` integer,
	`revoked_at` integer,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`cell_id`) REFERENCES `cells`(`cell_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rotated_from_id`) REFERENCES `safe_tokens`(`token_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `safe_tokens_token_hash_unique` ON `safe_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `state_transitions` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`from_state` text,
	`to_state` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_id` text,
	`command_id` text,
	`meta_json` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`project_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `state_transitions_command_id_unique` ON `state_transitions` (`command_id`);