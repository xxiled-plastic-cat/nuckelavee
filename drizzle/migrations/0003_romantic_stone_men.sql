CREATE TABLE "polymarket_market_status" (
	"condition_id" text PRIMARY KEY NOT NULL,
	"market_id" text,
	"market_slug" text,
	"event_id" text,
	"event_slug" text,
	"title" text,
	"status" text,
	"is_live" boolean DEFAULT false NOT NULL,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL,
	"end_date" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "polymarket_market_status_lifecycle_idx" ON "polymarket_market_status" USING btree ("is_live","is_resolved","is_closed");