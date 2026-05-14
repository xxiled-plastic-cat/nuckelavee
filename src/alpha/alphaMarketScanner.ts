import type { AlphaConfig } from "./alphaConfig.js";
import type { AlphaMarket, AlphaOrderbook } from "./alphaTypes.js";
import { AlphaSdkClient } from "./alphaClient.js";

const startupDebugEnabled = ["1", "true", "yes", "on"].includes(
  (process.env.ALPHA_DEBUG_STARTUP || process.env.NUCKELAVEE_DEBUG_STARTUP || "").toLowerCase(),
);

function logStartupDebug(message: string): void {
  if (!startupDebugEnabled) return;
  console.log(`[startup-debug ${new Date().toISOString()}] [scan] ${message}`);
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

export async function loadAlphaScan(client: AlphaSdkClient, config: AlphaConfig): Promise<AlphaScanResult> {
  const startedAt = Date.now();
  logStartupDebug(`loadAlphaScan start maxMarketsPerScan=${config.maxMarketsPerScan}`);
  const markets = (await client.getLiveMarkets()).filter(isLiveMarket);
  logStartupDebug(`live markets fetched count=${markets.length}`);
  let rewardMarkets: AlphaMarket[] = [];
  let rewardError: string | undefined;
  try {
    rewardMarkets = (await client.getRewardMarkets()).filter(isLiveMarket);
    logStartupDebug(`reward markets fetched count=${rewardMarkets.length}`);
  } catch (error) {
    rewardError = error instanceof Error ? error.message : String(error);
    logStartupDebug(`reward markets fetch failed error=${rewardError}`);
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
  const marketsToScan = [...marketsToScanByAppId.values()];
  logStartupDebug(`markets selected for orderbook scan count=${marketsToScan.length}`);
  const books = await Promise.all(
    marketsToScan.map(async (market, index) => {
      if (index < 5 || index % 10 === 0) {
        logStartupDebug(`orderbook fetch start idx=${index + 1}/${marketsToScan.length} appId=${market.marketAppId}`);
      }
      const book = await client.getOrderbook(market);
      if (index < 5 || index % 10 === 0) {
        logStartupDebug(`orderbook fetch done idx=${index + 1}/${marketsToScan.length} appId=${market.marketAppId}`);
      }
      return [market.marketAppId, book] as const;
    }),
  );
  logStartupDebug(`loadAlphaScan end elapsed_ms=${Date.now() - startedAt} orderbooks=${books.length}`);
  return {
    markets,
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
