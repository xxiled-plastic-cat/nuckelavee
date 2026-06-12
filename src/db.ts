import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../drizzle/schema.js";

let client: postgres.Sql | undefined;

function readCloseTimeoutSeconds(): number {
  const raw = process.env.DATABASE_CLOSE_TIMEOUT_SECONDS?.trim();
  if (!raw) return 1;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid DATABASE_CLOSE_TIMEOUT_SECONDS: ${raw}`);
  }
  return parsed;
}

function readPoolMax(): number {
  const raw = process.env.DATABASE_POOL_MAX?.trim();
  if (!raw) return 1;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid DATABASE_POOL_MAX: ${raw}`);
  }
  return parsed;
}

export function getDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for bot state persistence");
  }
  client ??= postgres(connectionString, {
    prepare: false,
    max: readPoolMax(),
    idle_timeout: 5,
  });
  return drizzle(client, { schema });
}

export async function closeDatabase(): Promise<void> {
  if (!client) return;
  const activeClient = client;
  client = undefined;
  await activeClient.end({ timeout: readCloseTimeoutSeconds() });
}

export type Database = ReturnType<typeof getDatabase>;
