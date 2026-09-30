CREATE TABLE `hazard_zones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`level` integer NOT NULL,
	`city` text NOT NULL,
	`min_lat` real NOT NULL,
	`min_lng` real NOT NULL,
	`max_lat` real NOT NULL,
	`max_lng` real NOT NULL,
	`rings` text NOT NULL,
	`version` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `hazard_zones_kind_idx` ON `hazard_zones` (`kind`);