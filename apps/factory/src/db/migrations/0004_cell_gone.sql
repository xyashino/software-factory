PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_jobs` (
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
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`incident_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("job_id", "project_id", "plan_id", "order_id", "step_id", "incident_id", "line_name", "kind", "workspace_mode", "status", "repo_url", "base_branch", "base_commit_sha", "target_branch", "expected_prior_steps_json", "payload_json", "cell_id", "epoch", "lease_expires_at", "result_commit_sha", "result_json", "error_detail", "created_at", "started_at", "finished_at") SELECT "job_id", "project_id", "plan_id", "order_id", "step_id", "incident_id", "line_name", "kind", "workspace_mode", "status", "repo_url", "base_branch", "base_commit_sha", "target_branch", "expected_prior_steps_json", "payload_json", "cell_id", "epoch", "lease_expires_at", "result_commit_sha", "result_json", "error_detail", "created_at", "started_at", "finished_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_jobs_one_active_per_order` ON `jobs` (`order_id`) WHERE "jobs"."order_id" IS NOT NULL AND "jobs"."status" IN ('claimed', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX `idx_jobs_one_active_per_cell` ON `jobs` (`cell_id`) WHERE "jobs"."cell_id" IS NOT NULL AND "jobs"."status" IN ('claimed', 'running');