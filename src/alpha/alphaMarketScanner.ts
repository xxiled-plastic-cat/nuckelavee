import type { AlphaConfig } from "./alphaConfig.js";
import type { AlphaMarket, AlphaOrderbook } from "./alphaTypes.js";
import { AlphaSdkClient } from "./alphaClient.js";
import {
  loadInactiveMarketAppIds,
  statusFromMarket,
  statusFromOrderbookResult,
  upsertAlphaMarketStatus,
} from "./alphaMarketStatusStore.js";
import { isDebugModeEnabled } from "../utils/debugMode.js";

function logStartupDebug(message: string): void {
  if (!isDebugModeEnabled()) return;
  console.log(`[startup-debug ${new Date().toISOString()}] [scan] ${message}`);
}

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 320 ? `${message.slice(0, 320)}...` : message;
}

export type AlphaScanResult = {
  markets: AlphaMarket[];
  rewardMarkets: AlphaMarket[];
  orderbooks: Map<number, AlphaOrderbook>;
  rewardError?: string;
};

function isLiveMarket(market: AlphaMarket): boolean {
  return !market.resolved && market.status === "live";
}

function parsePositiveIntOrFallback(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function parseOptionalLimit(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  if (normalized <= 0) return undefined;
  return normalized;
}

export async function loadAlphaScan(client: AlphaSdkClient, config: AlphaConfig): Promise<AlphaScanResult> {
  const startedAt = Date.now();
  logStartupDebug(`loadAlphaScan start maxMarketsPerScan=${config.maxMarketsPerScan}`);
  const fetchedMarkets = await client.getLiveMarkets();
  let markets = fetchedMarkets.filter(isLiveMarket);
  logStartupDebug(`live markets fetched count=${markets.length}`);
  let fetchedRewardMarkets: AlphaMarket[] = [];
  let rewardMarkets: AlphaMarket[] = [];
  let rewardError: string | undefined;
  try {
    fetchedRewardMarkets = await client.getRewardMarkets();
    rewardMarkets = fetchedRewardMarkets.filter(isLiveMarket);
    logStartupDebug(`reward markets fetched count=${rewardMarkets.length}`);
  } catch (error) {
    rewardError = error instanceof Error ? error.message : String(error);
    logStartupDebug(`reward markets fetch failed error=${rewardError}`);
  }

  const seenAt = new Date();
  const seenMarketsByAppId = new Map<number, AlphaMarket>(
    [...rewardMarkets, ...markets, ...fetchedRewardMarkets, ...fetchedMarkets].map((market) => [market.marketAppId, market]),
  );
  const seenMarkets = [...seenMarketsByAppId.values()];
  let marketStatusStoreAvailable = true;
  try {
    const inactiveMarketAppIds = await loadInactiveMarketAppIds(seenMarkets.map((market) => market.marketAppId));
    if (inactiveMarketAppIds.size > 0) {
      markets = markets.filter((market) => !inactiveMarketAppIds.has(market.marketAppId));
      rewardMarkets = rewardMarkets.filter((market) => !inactiveMarketAppIds.has(market.marketAppId));
      logStartupDebug(
        `persisted inactive markets filtered count=${inactiveMarketAppIds.size} remaining_live=${markets.length} remaining_reward=${rewardMarkets.length}`,
      );
    }

    await upsertAlphaMarketStatus(seenMarkets.map((market) => statusFromMarket(market, seenAt)));
    logStartupDebug(`market status rows upserted count=${seenMarkets.length}`);
  } catch (error) {
    marketStatusStoreAvailable = false;
    const message = shortError(error);
    logStartupDebug(`market status store unavailable; proceeding without persisted filtering error=${message}`);
  }

  const rewardByAppId = new Map<number, AlphaMarket>();
  for (const market of rewardMarkets) rewardByAppId.set(market.marketAppId, market);
  const spreadByAppId = new Map<number, AlphaMarket>();
  for (const market of markets) {
    if (!rewardByAppId.has(market.marketAppId)) spreadByAppId.set(market.marketAppId, market);
  }
  const marketsToScanByAppId = new Map<number, AlphaMarket>();
  for (const market of rewardByAppId.values()) {
    marketsToScanByAppId.set(market.marketAppId, market);
  }
  for (const market of spreadByAppId.values()) {
    marketsToScanByAppId.set(market.marketAppId, market);
  }
  const allMarketsToScan = [...marketsToScanByAppId.values()];
  const maxMarketsPerScan = parseOptionalLimit(config.maxMarketsPerScan);
  const marketsToScan = maxMarketsPerScan ? allMarketsToScan.slice(0, maxMarketsPerScan) : allMarketsToScan;
  if (maxMarketsPerScan && allMarketsToScan.length > marketsToScan.length) {
    logStartupDebug(
      `markets truncated for scan selected=${marketsToScan.length} total_live_candidates=${allMarketsToScan.length}`,
    );
  }
  const concurrency = parsePositiveIntOrFallback(config.orderbookFetchConcurrency, 12);
  logStartupDebug(
    `markets selected for orderbook scan count=${marketsToScan.length} concurrency=${Math.min(concurrency, Math.max(marketsToScan.length, 1))}`,
  );

  const books: Array<readonly [number, AlphaOrderbook]> = new Array(marketsToScan.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, Math.max(marketsToScan.length, 1));
  await Promise.all(
    Array.from({ length: workerCount }, async (_unused, workerIdx) => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= marketsToScan.length) break;
        const market = marketsToScan[index];
        if (index < 5 || (index + 1) % 25 === 0) {
          logStartupDebug(
            `orderbook fetch start idx=${index + 1}/${marketsToScan.length} appId=${market.marketAppId} worker=${workerIdx + 1}`,
          );
        }
        const book = await client.getOrderbook(market);
        books[index] = [market.marketAppId, book] as const;
        if (index < 5 || (index + 1) % 25 === 0) {
          logStartupDebug(
            `orderbook fetch done idx=${index + 1}/${marketsToScan.length} appId=${market.marketAppId} worker=${workerIdx + 1}`,
          );
        }
      }
    }),
  );
  const postFetchStatuses = marketsToScan
    .map((market, index) => {
      const entry = books[index];
      if (!entry) return undefined;
      return statusFromOrderbookResult(market, entry[1], new Date());
    })
    .filter((status): status is NonNullable<typeof status> => status !== undefined);
  if (marketStatusStoreAvailable && postFetchStatuses.length > 0) {
    try {
      await upsertAlphaMarketStatus(postFetchStatuses);
      logStartupDebug(`market status transitions upserted count=${postFetchStatuses.length}`);
    } catch (error) {
      const message = shortError(error);
      logStartupDebug(`market status transition upsert failed error=${message}`);
    }
  }
  logStartupDebug(`loadAlphaScan end elapsed_ms=${Date.now() - startedAt} orderbooks=${books.length}`);
  return {
    markets: marketsToScan,
    rewardMarkets,
    orderbooks: new Map(books),
    rewardError,
  };
}

export function summarizeBooks(books: Iterable<AlphaOrderbook>): {
  twoSided: number;
  oneSided: number;
  empty: number;
  averageSpread: number;
} {
  let twoSided = 0;
  let oneSided = 0;
  let empty = 0;
  let spreadTotal = 0;
  let spreadCount = 0;
  for (const book of books) {
    const hasBid = book.yesBid !== undefined || book.noBid !== undefined;
    const hasAsk = book.yesAsk !== undefined || book.noAsk !== undefined;
    if (hasBid && hasAsk) twoSided += 1;
    else if (hasBid || hasAsk) oneSided += 1;
    else empty += 1;
    if (book.bestSpread !== undefined) {
      spreadTotal += book.bestSpread;
      spreadCount += 1;
    }
  }
  return { twoSided, oneSided, empty, averageSpread: spreadCount > 0 ? spreadTotal / spreadCount : 0 };
}
