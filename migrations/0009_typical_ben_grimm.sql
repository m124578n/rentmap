CREATE TABLE `pois` (
	`category` text NOT NULL,
	`key` text NOT NULL,
	`subtype` text,
	`name` text,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`rating` real,
	`url` text,
	`version` text NOT NULL,
	PRIMARY KEY(`category`, `key`)
);
--> statement-breakpoint
CREATE INDEX `pois_latlng_idx` ON `pois` (`lat`,`lng`);