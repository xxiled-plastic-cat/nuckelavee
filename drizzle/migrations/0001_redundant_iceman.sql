CREATE TABLE "alpha_market_status" (
	"market_app_id" bigint PRIMARY KEY NOT NULL,
	"market_id" varchar(128),
	"slug" varchar(255),
	"status" varchar(32),
	"is_live" boolean DEFAULT false NOT NULL,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL,
	"end_ts" bigint,
	"close_time" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "alpha_market_status_lifecycle_idx" ON "alpha_market_status" USING btree ("is_live","is_resolved","is_closed");