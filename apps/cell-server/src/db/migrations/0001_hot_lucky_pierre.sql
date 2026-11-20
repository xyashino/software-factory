ALTER TABLE `factories` ADD `name` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `factories` SET `name` = `factory_id` WHERE `name` = '';--> statement-breakpoint
ALTER TABLE `factories` ADD `join_token` text;--> statement-breakpoint
ALTER TABLE `factories` ADD `supervisor_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_factories_name` ON `factories` (`name`);