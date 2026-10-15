CREATE TABLE `shares` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`params` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shares_user_idx` ON `shares` (`user_id`);