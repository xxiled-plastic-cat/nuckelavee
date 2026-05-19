import { and, eq, inArray, or, sql } from "drizzle-orm";

import { polymarketMarketStatus } from "../../drizzle/schema.js";
import { getDatabase } from "../db.js";
import type { PolyMarket } from "./polyTypes.js";

export type PolyMarketStatusUpsert = {
  conditionId: string;
  marketId?: string;
  marketSlug?: string;
  eventId?: string;
  eventSlug?: string;
  title?: string;
  status?: string;
  isLive: boolean;
  isResolved: boolean;
  isClosed: boolean;
  endDate?: Date;
  lastSeenAt: Date;
};

const UPSERT_BATCH_SIZE = 200;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function readBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function inferResolved(raw: Record<string, unknown> | undefined): boolean {
  if (!raw) return false;
  const directResolved = readBool(raw.resolved ?? raw.isResolved);
  if (directResolved !== undefined) return directResolved;
  const winner = readString(raw.winner ?? raw.winningOutcome);
  if (winner) return true;
  const status = readString(raw.status)?.toLowerCase();
  return status === "resolved" || status === "finalized" || status === "settled";
}

export function statusFromPolyMarket(market: PolyMarket, seenAt = new Date()): PolyMarketStatusUpsert {
  const raw = asRecord(market.raw);
  const rawStatus = readString(raw?.status);
  const endDate = parseDate(market.endDate);
  const endedByTime = endDate !== undefined && endDate.getTime() <= seenAt.getTime();
  const isResolved = Boolean(market.isResolved || inferResolved(raw) || endedByTime || market.closed);
  const isClosed = Boolean(market.closed || !market.active || endedByTime || isResolved);
  const isLive = Boolean(market.isLive && !isClosed && !isResolved);
  return {
    conditionId: market.conditionId,
    marketId: market.marketId,
    marketSlug: market.marketSlug,
    eventId: market.eventId,
    eventSlug: market.eventSlug,
    title: market.title,
    status: rawStatus ?? (isResolved ? "resolved" : isClosed ? "closed" : "live"),
    isLive,
    isResolved,
    isClosed,
    endDate,
    lastSeenAt: seenAt,
  };
}

export async function upsertPolyMarketStatus(rows: PolyMarketStatusUpsert[]): Promise<void> {
  if (rows.length === 0) return;
  const db = getDatabase();
  for (let offset = 0; offset < rows.length; offset += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + UPSERT_BATCH_SIZE);
    await db
      .insert(polymarketMarketStatus)
      .values(
        batch.map((row) => ({
          conditionId: row.conditionId,
          marketId: row.marketId,
          marketSlug: row.marketSlug,
          eventId: row.eventId,
          eventSlug: row.eventSlug,
          title: row.title,
          status: row.status,
          isLive: row.isLive,
          isResolved: row.isResolved,
          isClosed: row.isClosed,
          endDate: row.endDate,
          lastSeenAt: row.lastSeenAt,
        })),
      )
      .onConflictDoUpdate({
        target: polymarketMarketStatus.conditionId,
        set: {
          marketId: sql`excluded.market_id`,
          marketSlug: sql`excluded.market_slug`,
          eventId: sql`excluded.event_id`,
          eventSlug: sql`excluded.event_slug`,
          title: sql`excluded.title`,
          status: sql`
            case
              when (${polymarketMarketStatus.isResolved} = true or ${polymarketMarketStatus.isClosed} = true) and excluded.is_live = true
                then ${polymarketMarketStatus.status}
              else excluded.status
            end
          `,
          isLive: sql`
            case
              when ${polymarketMarketStatus.isResolved} = true or ${polymarketMarketStatus.isClosed} = true
                then false
              else excluded.is_live
            end
          `,
          isResolved: sql`${polymarketMarketStatus.isResolved} or excluded.is_resolved`,
          isClosed: sql`${polymarketMarketStatus.isClosed} or excluded.is_closed`,
          endDate: sql`excluded.end_date`,
          lastSeenAt: sql`excluded.last_seen_at`,
          updatedAt: new Date(),
        },
      });
  }
}

export async function loadInactiveConditionIds(conditionIds: string[]): Promise<Set<string>> {
  if (conditionIds.length === 0) return new Set();
  const db = getDatabase();
  const inactiveConditionIds = new Set<string>();
  for (let offset = 0; offset < conditionIds.length; offset += UPSERT_BATCH_SIZE) {
    const batch = conditionIds.slice(offset, offset + UPSERT_BATCH_SIZE);
    const rows = await db
      .select({ conditionId: polymarketMarketStatus.conditionId })
      .from(polymarketMarketStatus)
      .where(
        and(
          inArray(polymarketMarketStatus.conditionId, batch),
          or(
            eq(polymarketMarketStatus.isResolved, true),
            eq(polymarketMarketStatus.isClosed, true),
            eq(polymarketMarketStatus.isLive, false),
          ),
        ),
      );
    for (const row of rows) inactiveConditionIds.add(row.conditionId);
  }
  return inactiveConditionIds;
}
