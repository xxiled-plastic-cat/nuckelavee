import type { AlphaMarket, AlphaOpportunity, AlphaOrderbook, AlphaParityPlan, AlphaQuote } from "../alpha/alphaTypes.js";

export type CatalogMarketDto = {
  id: string;
  marketAppId: number;
  slug?: string;
  title: string;
  category?: string;
  status: string;
  closeTime?: string;
  isRewardMarket: boolean;
  dailyRewardsUsd?: number;
};

export type BookSummaryDto = {
  marketAppId: number;
  source: AlphaOrderbook["source"];
  yesBid?: number;
  yesAsk?: number;
  noBid?: number;
  noAsk?: number;
  yesMid?: number;
  noMid?: number;
  yesSpread?: number;
  noSpread?: number;
  bestSpread?: number;
  yesBidDepthShares: number;
  yesAskDepthShares: number;
  noBidDepthShares: number;
  noAskDepthShares: number;
};

export type OpportunityDto = AlphaOpportunity & {
  sizeShares?: number;
  notionalUsd?: number;
  yesPrice?: number;
  noPrice?: number;
  estimatedNetEdgeBps?: number;
};

export type QuoteDto = Omit<AlphaQuote, never>;

export type Envelope<T> = {
  asOf: string;
  venue: "alpha";
  count: number;
  items: T[];
};

function depthShares(levels: { quantityShares: number }[]): number {
  return levels.reduce((sum, level) => sum + level.quantityShares, 0);
}

export function toCatalogMarket(market: AlphaMarket): CatalogMarketDto {
  return {
    id: market.id,
    marketAppId: market.marketAppId,
    slug: market.slug,
    title: market.title,
    category: market.category,
    status: market.status,
    closeTime: market.closeTime,
    isRewardMarket: market.reward.isRewardMarket,
    dailyRewardsUsd: market.reward.dailyRewardsUsd,
  };
}

export function toBookSummary(book: AlphaOrderbook): BookSummaryDto {
  return {
    marketAppId: book.marketAppId,
    source: book.source,
    yesBid: book.yesBid,
    yesAsk: book.yesAsk,
    noBid: book.noBid,
    noAsk: book.noAsk,
    yesMid: book.yesMid,
    noMid: book.noMid,
    yesSpread: book.yesSpread,
    noSpread: book.noSpread,
    bestSpread: book.bestSpread,
    yesBidDepthShares: depthShares(book.yesSideOrders.bids),
    yesAskDepthShares: depthShares(book.yesSideOrders.asks),
    noBidDepthShares: depthShares(book.noSideOrders.bids),
    noAskDepthShares: depthShares(book.noSideOrders.asks),
  };
}

export function toOpportunityDto(opportunity: AlphaOpportunity): OpportunityDto {
  return { ...opportunity };
}

export function parityToOpportunityDto(plan: AlphaParityPlan): OpportunityDto {
  return {
    type: plan.type,
    marketId: plan.marketId,
    marketAppId: plan.marketAppId,
    slug: plan.slug,
    title: plan.title,
    edgeBps: plan.estimatedNetEdgeBps,
    confidence: plan.warnings.length === 0 ? "high" : "medium",
    classification: "CANDIDATE",
    reason: `netEdge=${plan.estimatedNetEdgeBps.toFixed(1)}bps gross=${plan.grossEdgeBps.toFixed(1)}bps`,
    requiredAction: plan.requiredAction,
    warnings: plan.warnings,
    reward: { rewardEligible: false },
    sizeShares: plan.sizeShares,
    notionalUsd: plan.notionalUsd,
    yesPrice: plan.yesPrice,
    noPrice: plan.noPrice,
    estimatedNetEdgeBps: plan.estimatedNetEdgeBps,
  };
}

export function toQuoteDto(quote: AlphaQuote): QuoteDto {
  return { ...quote };
}

export function toPublicMarket(market: AlphaMarket): Omit<AlphaMarket, "raw"> {
  const { raw: _raw, ...rest } = market;
  return rest;
}
