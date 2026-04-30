import type { AlphaConfig } from "./alphaConfig.js";
import type { AlphaBookLevel, AlphaMarket, AlphaOrderbook, AlphaParityPlan } from "./alphaTypes.js";

function totalShares(levels: AlphaBookLevel[]): number {
  return levels.reduce((sum, level) => sum + level.quantityShares, 0);
}

function weightedPrice(levels: AlphaBookLevel[], shares: number): number | undefined {
  let remaining = shares;
  let total = 0;
  for (const level of levels) {
    const take = Math.min(remaining, level.quantityShares);
    total += take * level.price;
    remaining -= take;
    if (remaining <= 0.000001) break;
  }
  if (remaining > 0.000001) return undefined;
  return total / shares;
}

function findBestSize(
  yesLevels: AlphaBookLevel[],
  noLevels: AlphaBookLevel[],
  maxShares: number,
  minShares: number,
  minNetEdgeBps: number,
  slippageCents: number,
  edgeForPrices: (yesPrice: number, noPrice: number) => number,
): { sizeShares: number; yesPrice: number; noPrice: number; grossEdgeBps: number; estimatedNetEdgeBps: number } | undefined {
  if (maxShares < minShares) return undefined;
  const slippageBufferBps = (slippageCents / 100) * 2 * 10_000;
  let low = minShares;
  let high = maxShares;
  let best: { sizeShares: number; yesPrice: number; noPrice: number; grossEdgeBps: number; estimatedNetEdgeBps: number } | undefined;

  for (let i = 0; i < 24; i += 1) {
    const sizeShares = (low + high) / 2;
    const yesPrice = weightedPrice(yesLevels, sizeShares);
    const noPrice = weightedPrice(noLevels, sizeShares);
    if (yesPrice === undefined || noPrice === undefined) {
      high = sizeShares;
      continue;
    }
    const grossEdgeBps = edgeForPrices(yesPrice, noPrice);
    const estimatedNetEdgeBps = grossEdgeBps - slippageBufferBps;
    if (estimatedNetEdgeBps >= minNetEdgeBps) {
      best = { sizeShares, yesPrice, noPrice, grossEdgeBps, estimatedNetEdgeBps };
      low = sizeShares;
    } else {
      high = sizeShares;
    }
  }
  return best;
}

function planParityBuy(market: AlphaMarket, book: AlphaOrderbook, config: AlphaConfig): AlphaParityPlan | undefined {
  const yesAsks = [...book.yesSideOrders.asks].sort((a, b) => a.price - b.price);
  const noAsks = [...book.noSideOrders.asks].sort((a, b) => a.price - b.price);
  const maxShares = Math.min(totalShares(yesAsks), totalShares(noAsks), config.parityMaxTradeUsd);
  const minShares = config.parityMinDepthUsd;
  const best = findBestSize(
    yesAsks,
    noAsks,
    maxShares,
    minShares,
    config.parityMinEdgeBps,
    config.paritySlippageCents,
    (yesPrice, noPrice) => (1 - yesPrice - noPrice) * 10_000,
  );
  if (!best) return undefined;
  const notionalUsd = best.sizeShares * (best.yesPrice + best.noPrice);
  return {
    type: "PARITY",
    marketId: market.id,
    marketAppId: market.marketAppId,
    slug: market.slug,
    title: market.title,
    sizeShares: best.sizeShares,
    notionalUsd,
    yesPrice: best.yesPrice,
    noPrice: best.noPrice,
    grossEdgeBps: best.grossEdgeBps,
    estimatedNetEdgeBps: best.estimatedNetEdgeBps,
    expectedGrossPnlUsd: best.sizeShares - notionalUsd,
    requiredAction: "market-buy YES and NO, then merge paired shares to USDC",
    warnings: [],
  };
}

function planSplitSell(market: AlphaMarket, book: AlphaOrderbook, config: AlphaConfig): AlphaParityPlan | undefined {
  const yesBids = [...book.yesSideOrders.bids].sort((a, b) => b.price - a.price);
  const noBids = [...book.noSideOrders.bids].sort((a, b) => b.price - a.price);
  const maxShares = Math.min(totalShares(yesBids), totalShares(noBids), config.parityMaxTradeUsd);
  const minShares = config.parityMinDepthUsd;
  const best = findBestSize(
    yesBids,
    noBids,
    maxShares,
    minShares,
    config.parityMinEdgeBps,
    config.paritySlippageCents,
    (yesPrice, noPrice) => (yesPrice + noPrice - 1) * 10_000,
  );
  if (!best) return undefined;
  const proceedsUsd = best.sizeShares * (best.yesPrice + best.noPrice);
  return {
    type: "SPLIT_MERGE",
    marketId: market.id,
    marketAppId: market.marketAppId,
    slug: market.slug,
    title: market.title,
    sizeShares: best.sizeShares,
    notionalUsd: best.sizeShares,
    yesPrice: best.yesPrice,
    noPrice: best.noPrice,
    grossEdgeBps: best.grossEdgeBps,
    estimatedNetEdgeBps: best.estimatedNetEdgeBps,
    expectedGrossPnlUsd: proceedsUsd - best.sizeShares,
    requiredAction: "split USDC into YES/NO, then market-sell both sides",
    warnings: ["split-and-sell should stay disabled until buy-and-merge is proven"],
  };
}

export function scanParity(markets: AlphaMarket[], books: Map<number, AlphaOrderbook>, config: AlphaConfig): AlphaParityPlan[] {
  const plans: AlphaParityPlan[] = [];
  for (const market of markets) {
    const book = books.get(market.marketAppId);
    if (!book || book.source === "unavailable") continue;
    const parity = planParityBuy(market, book, config);
    if (parity) plans.push(parity);
    const splitSell = planSplitSell(market, book, config);
    if (splitSell) plans.push(splitSell);
  }
  return plans.sort((a, b) => b.estimatedNetEdgeBps - a.estimatedNetEdgeBps);
}
