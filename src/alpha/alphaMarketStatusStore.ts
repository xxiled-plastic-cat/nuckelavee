import { and, eq, inArray, or, sql } from "drizzle-orm";

import { alphaMarketStatus } from "../../drizzle/schema.js";
import { getDatabase } from "../db.js";
import type { AlphaMarket, AlphaOrderbook } from "./alphaTypes.js";

export type AlphaMarketStatusUpsert = {
  marketAppId: number;
  marketId?: string;
  slug?: string;
  status?: string;
  isLive: boolean;
  isResolved: boolean;
  isClosed: boolean;
  endTs?: number;
  closeTime?: Date;
  lastSeenAt: Date;
};

const UPSERT_BATCH_SIZE = 200;

function parseCloseTime(closeTime: string | undefined): Date | undefined {
  if (!closeTime) return undefined;
  const parsed = new Date(closeTime);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function statusFromMarket(market: AlphaMarket, seenAt = new Date()): AlphaMarketStatusUpsert {
  const status = (market.status || "").toLowerCase();
  const isResolved = Boolean(market.resolved || status === "resolved");
  const isClosed = Boolean(status === "closed" || status === "ended" || isResolved);
  const isLive = Boolean(!isClosed && status === "live");
  return {
    marketAppId: market.marketAppId,
    marketId: market.id,
    slug: market.slug,
    status: market.status,
    isLive,
    isResolved,
    isClosed,
    endTs: market.endTs,
    closeTime: parseCloseTime(market.closeTime),
    lastSeenAt: seenAt,
  };
}

export function statusFromOrderbookResult(
  market: AlphaMarket,
  orderbook: AlphaOrderbook,
  seenAt = new Date(),
): AlphaMarketStatusUpsert | undefined {
  if (orderbook.source !== "unavailable") return undefined;
  if (!orderbook.raw || typeof orderbook.raw !== "object") return undefined;
  const raw = orderbook.raw as {
    reason?: unknown;
    chainStatus?: { isResolved?: boolean; isActivated?: boolean };
  };
  const chainStatus = raw.chainStatus;
  const reason = typeof raw.reason === "string" ? raw.reason : "";
  const resolved = Boolean(chainStatus?.isResolved);
  const inactive = chainStatus?.isActivated === false || reason.includes("not live on-chain");
  if (!resolved && !inactive) return undefined;
  return {
    marketAppId: market.marketAppId,
    marketId: market.id,
    slug: market.slug,
    status: resolved ? "resolved" : "closed",
    isLive: false,
    isResolved: resolved,
    isClosed: true,
    endTs: market.endTs,
    closeTime: parseCloseTime(market.closeTime),
    lastSeenAt: seenAt,
  };
}

export async function upsertAlphaMarketStatus(rows: AlphaMarketStatusUpsert[]): Promise<void> {
  if (rows.length === 0) return;
  const db = getDatabase();
  for (let offset = 0; offset < rows.length; offset += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + UPSERT_BATCH_SIZE);
    await db
      .insert(alphaMarketStatus)
      .values(
        batch.map((row) => ({
          marketAppId: row.marketAppId,
          marketId: row.marketId,
          slug: row.slug,
          status: row.status,
          isLive: row.isLive,
          isResolved: row.isResolved,
          isClosed: row.isClosed,
          endTs: row.endTs,
          closeTime: row.closeTime,
          lastSeenAt: row.lastSeenAt,
        })),
      )
      .onConflictDoUpdate({
        target: alphaMarketStatus.marketAppId,
        set: {
          marketId: sql`excluded.market_id`,
          slug: sql`excluded.slug`,
          status: sql`
            case
              when (${alphaMarketStatus.isResolved} = true or ${alphaMarketStatus.isClosed} = true) and excluded.is_live = true
                then ${alphaMarketStatus.status}
              else excluded.status
            end
          `,
          isLive: sql`
            case
              when ${alphaMarketStatus.isResolved} = true or ${alphaMarketStatus.isClosed} = true
                then false
              else excluded.is_live
            end
          `,
          isResolved: sql`${alphaMarketStatus.isResolved} or excluded.is_resolved`,
          isClosed: sql`${alphaMarketStatus.isClosed} or excluded.is_closed`,
          endTs: sql`excluded.end_ts`,
          closeTime: sql`excluded.close_time`,
          lastSeenAt: sql`excluded.last_seen_at`,
          updatedAt: new Date(),
        },
      });
  }
}

export async function loadInactiveMarketAppIds(appIds: number[]): Promise<Set<number>> {
  if (appIds.length === 0) return new Set();
  const db = getDatabase();
  const inactiveMarketAppIds = new Set<number>();
  for (let offset = 0; offset < appIds.length; offset += UPSERT_BATCH_SIZE) {
    const batch = appIds.slice(offset, offset + UPSERT_BATCH_SIZE);
    const rows = await db
      .select({ marketAppId: alphaMarketStatus.marketAppId })
      .from(alphaMarketStatus)
      .where(
        and(
          inArray(alphaMarketStatus.marketAppId, batch),
          or(
            eq(alphaMarketStatus.isResolved, true),
            eq(alphaMarketStatus.isClosed, true),
            eq(alphaMarketStatus.isLive, false),
          ),
        ),
      );
    for (const row of rows) inactiveMarketAppIds.add(row.marketAppId);
  }
  return inactiveMarketAppIds;
}
