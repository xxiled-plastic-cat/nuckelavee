import { bigint, boolean, index, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const botStates = pgTable("bot_states", {
  key: varchar("key", { length: 128 }).primaryKey(),
  state: jsonb("state").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const alphaMarketStatus = pgTable(
  "alpha_market_status",
  {
    marketAppId: bigint("market_app_id", { mode: "number" }).primaryKey(),
    marketId: text("market_id"),
    slug: text("slug"),
    status: text("status"),
    isLive: boolean("is_live").notNull().default(false),
    isResolved: boolean("is_resolved").notNull().default(false),
    isClosed: boolean("is_closed").notNull().default(false),
    endTs: bigint("end_ts", { mode: "number" }),
    closeTime: timestamp("close_time", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    lifecycleIdx: index("alpha_market_status_lifecycle_idx").on(table.isLive, table.isResolved, table.isClosed),
  }),
);
