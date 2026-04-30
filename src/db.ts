import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../drizzle/schema.js";

let client: postgres.Sql | undefined;

export function getDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for bot state persistence");
  }
  client ??= postgres(connectionString, { prepare: false });
  return drizzle(client, { schema });
}

export async function closeDatabase(): Promise<void> {
  if (!client) return;
  const activeClient = client;
  client = undefined;
  await activeClient.end();
}

export type Database = ReturnType<typeof getDatabase>;
