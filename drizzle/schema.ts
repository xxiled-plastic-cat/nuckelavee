import { jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export const botStates = pgTable("bot_states", {
  key: varchar("key", { length: 128 }).primaryKey(),
  state: jsonb("state").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
