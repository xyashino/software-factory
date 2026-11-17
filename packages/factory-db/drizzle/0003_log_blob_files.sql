CREATE TABLE `blob_files` (
	`ref` text PRIMARY KEY NOT NULL,
	`size` integer NOT NULL,
	`encoding` text NOT NULL,
	`media_type` text NOT NULL,
	`created_at` integer NOT NULL
);
