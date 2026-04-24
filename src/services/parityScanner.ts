import type { Market, ParityOpportunity } from "../types/market.js";
import { applyTakerMatchFeeBps, toBps } from "../utils/math.js";

export function scanParity(markets: Market[], minEdgeBps: number): ParityOpportunity[] {
  const opportunities: ParityOpportunity[] = [];

  for (const market of markets) {
    if (market.yesAsk !== undefined && market.noAsk !== undefined) {
      const totalAsk = market.yesAsk + market.noAsk;
      if (totalAsk < 1) {
        const edgeBps = toBps(1 - totalAsk);
        if (edgeBps >= minEdgeBps) {
          opportunities.push({
            type: "parity",
            kind: "cheap_pair",
            marketId: market.id,
            underlying: market.underlying,
            timeframe: market.timeframe,
            strike: market.strike,
            expiryTs: market.expiryTs,
            yesPrice: market.yesAsk,
            noPrice: market.noAsk,
            edgeBps,
            takerAdjustedEdgeBps: applyTakerMatchFeeBps(edgeBps),
          });
        }
      }
    }

    if (market.yesBid !== undefined && market.noBid !== undefined) {
      const totalBid = market.yesBid + market.noBid;
      if (totalBid > 1) {
        const edgeBps = toBps(totalBid - 1);
        if (edgeBps >= minEdgeBps) {
          opportunities.push({
            type: "parity",
            kind: "rich_pair",
            marketId: market.id,
            underlying: market.underlying,
            timeframe: market.timeframe,
            strike: market.strike,
            expiryTs: market.expiryTs,
            yesPrice: market.yesBid,
            noPrice: market.noBid,
            edgeBps,
            takerAdjustedEdgeBps: applyTakerMatchFeeBps(edgeBps),
          });
        }
      }
    }
  }

  return opportunities.sort((a, b) => b.edgeBps - a.edgeBps);
}
