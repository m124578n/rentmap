CREATE TABLE `plan_grants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`offer` text NOT NULL,
	`plan` text NOT NULL,
	`days` integer NOT NULL,
	`price` integer NOT NULL,
	`ref` text NOT NULL,
	`until_after` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_grants_ref_uq` ON `plan_grants` (`ref`);--> statement-breakpoint
CREATE INDEX `plan_grants_user_idx` ON `plan_grants` (`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `plan` text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `plan_until` text;