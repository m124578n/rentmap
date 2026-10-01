CREATE TABLE `road_graphs` (
	`region` text NOT NULL,
	`version` text NOT NULL,
	`chunk` integer NOT NULL,
	`total` integer NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`region`, `version`, `chunk`)
);
