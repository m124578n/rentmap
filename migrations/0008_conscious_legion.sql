CREATE TABLE `user_requirements` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`json` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
