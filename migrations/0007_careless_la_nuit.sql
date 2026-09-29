CREATE TABLE `rent_stats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`serial` text NOT NULL,
	`city` text NOT NULL,
	`district` text NOT NULL,
	`road` text,
	`kind` text,
	`building_type` text,
	`floor` integer,
	`total_floors` integer,
	`building_age` integer,
	`size_ping` real,
	`rooms` integer,
	`livings` integer,
	`baths` integer,
	`rent` integer NOT NULL,
	`date` text NOT NULL,
	`has_elevator` integer,
	`furnished` integer,
	`has_mgmt` integer,
	`has_parking` integer NOT NULL,
	`social` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rent_stats_serial_idx` ON `rent_stats` (`serial`);--> statement-breakpoint
CREATE INDEX `rent_stats_area_idx` ON `rent_stats` (`city`,`district`,`kind`);--> statement-breakpoint
CREATE INDEX `rent_stats_date_idx` ON `rent_stats` (`date`);