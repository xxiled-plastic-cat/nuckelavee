import type { AlphaConfig } from "./alphaConfig.js";
import type { AlphaMarket, AlphaOpportunity, AlphaOrderbook } from "./alphaTypes.js";

export function scanParity(markets: AlphaMarket[], books: Map<number, AlphaOrderbook>, config: AlphaConfig): AlphaOpportunity[] {
  const threshold = config.parityBufferBps / 10_000;
  const opportunities: AlphaOpportunity[] = [];
  for (const market of markets) {
    const book = books.get(market.marketAppId);
    if (!book) continue;
    if (book.yesAsk !== undefined && book.noAsk !== undefined && book.yesAsk + book.noAsk < 1 - threshold) {
      opportunities.push({
        type: "PARITY",
        marketId: market.id,
        marketAppId: market.marketAppId,
        slug: market.slug,
        title: market.title,
        edgeBps: (1 - (book.yesAsk + book.noAsk)) * 10_000,
        confidence: "medium",
        classification: "MECHANICAL",
        reason: `YES ask + NO ask = ${(book.yesAsk + book.noAsk).toFixed(4)}`,
        requiredAction: "buy both sides, then merge if supported",
        warnings: ["detect-only in this rollout", "confirm fees, depth, and merge availability"],
        reward: { rewardEligible: false },
      });
    }
    if (book.yesBid !== undefined && book.noBid !== undefined && book.yesBid + book.noBid > 1 + threshold) {
      opportunities.push({
        type: "SPLIT_MERGE",
        marketId: market.id,
        marketAppId: market.marketAppId,
        slug: market.slug,
        title: market.title,
        edgeBps: (book.yesBid + book.noBid - 1) * 10_000,
        confidence: "medium",
        classification: "MECHANICAL",
        reason: `YES bid + NO bid = ${(book.yesBid + book.noBid).toFixed(4)}`,
        requiredAction: "split USDC into YES/NO, sell both sides",
        warnings: ["detect-only in this rollout", "confirm fees, depth, and split availability"],
        reward: { rewardEligible: false },
      });
    }
  }
  return opportunities.sort((a, b) => (b.edgeBps ?? 0) - (a.edgeBps ?? 0));
}
