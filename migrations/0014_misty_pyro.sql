ALTER TABLE `listings` ADD `price` integer;--> statement-breakpoint
ALTER TABLE `properties` ADD `deal` text DEFAULT 'rent' NOT NULL;--> statement-breakpoint
ALTER TABLE `properties` ADD `land_ping` real;