CREATE TABLE `sale_stats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`serial` text NOT NULL,
	`city` text NOT NULL,
	`district` text NOT NULL,
	`road` text,
	`building_type` text NOT NULL,
	`floor` integer,
	`total_floors` integer,
	`building_age` integer,
	`size_ping` real,
	`price` integer NOT NULL,
	`unit_price` integer,
	`rooms` integer,
	`has_parking` integer NOT NULL,
	`parking_price` integer,
	`date` text NOT NULL,
	`has_elevator` integer,
	`has_mgmt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sale_stats_serial_idx` ON `sale_stats` (`serial`);--> statement-breakpoint
CREATE INDEX `sale_stats_area_idx` ON `sale_stats` (`city`,`district`,`building_type`);--> statement-breakpoint
CREATE INDEX `sale_stats_date_idx` ON `sale_stats` (`date`);