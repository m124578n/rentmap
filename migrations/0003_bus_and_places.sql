CREATE TABLE `bus_route_stops` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`route_key` text NOT NULL,
	`seq` integer NOT NULL,
	`stop_uid` text NOT NULL,
	`station_id` text,
	`name` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`dist_m` integer NOT NULL,
	`t_min` integer,
	`version` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brs_route_seq_uq` ON `bus_route_stops` (`route_key`,`seq`);--> statement-breakpoint
CREATE INDEX `brs_latlng_idx` ON `bus_route_stops` (`lat`,`lng`);--> statement-breakpoint
CREATE TABLE `bus_routes` (
	`key` text PRIMARY KEY NOT NULL,
	`route_uid` text NOT NULL,
	`name` text NOT NULL,
	`city` text NOT NULL,
	`direction` integer NOT NULL,
	`from_name` text,
	`to_name` text,
	`stop_count` integer NOT NULL,
	`length_m` integer NOT NULL,
	`shape_json` text NOT NULL,
	`schedule_json` text,
	`version` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `my_places` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `my_places_user_idx` ON `my_places` (`user_id`);