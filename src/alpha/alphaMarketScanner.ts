import type { AlphaConfig } from "./alphaConfig.js";
import type { AlphaMarket, AlphaOrderbook } from "./alphaTypes.js";
import { AlphaSdkClient } from "./alphaClient.js";

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
  const markets = (await client.getLiveMarkets()).filter(isLiveMarket);
  let rewardMarkets: AlphaMarket[] = [];
  let rewardError: string | undefined;
  try {
    rewardMarkets = (await client.getRewardMarkets()).filter(isLiveMarket);
  } catch (error) {
    rewardError = error instanceof Error ? error.message : String(error);
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
  const books = await Promise.all(
    marketsToScan.map(async (market) => [market.marketAppId, await client.getOrderbook(market)] as const),
  );
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
