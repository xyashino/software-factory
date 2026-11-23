ALTER TABLE `factories` ADD `projects_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `claimed_by_cell_id` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `claimed_by_factory_id` text REFERENCES factories(factory_id);--> statement-breakpoint
ALTER TABLE `work_orders` ADD `pinned_factory_id` text REFERENCES factories(factory_id);--> statement-breakpoint
UPDATE `jobs` SET `claimed_by_cell_id` = `cell_id` WHERE `cell_id` IS NOT NULL;--> statement-breakpoint
UPDATE `jobs` SET `claimed_by_factory_id` = (SELECT `cells`.`factory_id` FROM `cells` WHERE `cells`.`cell_id` = `jobs`.`cell_id`) WHERE `cell_id` IS NOT NULL;--> statement-breakpoint
UPDATE `work_orders` SET `pinned_factory_id` = (SELECT `cells`.`factory_id` FROM `cells` WHERE `cells`.`cell_id` = `work_orders`.`pinned_cell_id`) WHERE `pinned_cell_id` IS NOT NULL;