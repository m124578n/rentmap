CREATE TABLE `favorites` (
	`user_id` integer NOT NULL,
	`property_id` integer NOT NULL,
	`stage` text DEFAULT 'saved' NOT NULL,
	`tags_json` text,
	`priority` integer,
	`note` text,
	`rank` integer,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `favorites_uq` ON `favorites` (`user_id`,`property_id`);--> statement-breakpoint
CREATE TABLE `listing_price_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listing_id` integer NOT NULL,
	`rent` integer NOT NULL,
	`seen_at` text NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lph_listing_idx` ON `listing_price_history` (`listing_id`);--> statement-breakpoint
CREATE TABLE `listings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` integer NOT NULL,
	`source` text NOT NULL,
	`source_url` text,
	`source_listing_id` text,
	`rent` integer NOT NULL,
	`deposit_months` real,
	`raw_json` text,
	`contact_name` text,
	`contact_phone` text,
	`contact_line` text,
	`status` text DEFAULT 'active' NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`last_checked_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `listings_property_idx` ON `listings` (`property_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `listings_source_uq` ON `listings` (`source`,`source_listing_id`);--> statement-breakpoint
CREATE TABLE `pending_urls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`url` text NOT NULL,
	`source` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`property_id` integer,
	`requested_at` text NOT NULL,
	`done_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `pending_urls_status_idx` ON `pending_urls` (`status`);--> statement-breakpoint
CREATE TABLE `properties` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`city` text NOT NULL,
	`district` text NOT NULL,
	`road` text,
	`address_text` text,
	`lat` real,
	`lng` real,
	`geocode_source` text,
	`building_type` text,
	`floor` integer,
	`total_floors` integer,
	`building_age` integer,
	`size_ping` real,
	`rooms` integer,
	`living_rooms` integer,
	`bathrooms` integer,
	`has_elevator` integer,
	`has_parking` integer,
	`pet_allowed` integer,
	`cooking_allowed` integer,
	`has_washer` integer,
	`has_internet` integer,
	`furniture_json` text,
	`mgmt_fee` integer,
	`utilities_note` text,
	`nearest_mrt_id` text,
	`mrt_walk_min` integer,
	`note` text,
	`created_by` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `properties_city_district_idx` ON `properties` (`city`,`district`);--> statement-breakpoint
CREATE INDEX `properties_latlng_idx` ON `properties` (`lat`,`lng`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`provider_id` text NOT NULL,
	`display_name` text,
	`avatar_url` text,
	`email` text,
	`created_at` text NOT NULL,
	`last_login_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_provider_uq` ON `users` (`provider`,`provider_id`);