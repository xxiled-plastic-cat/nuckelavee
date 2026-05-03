export type PolyOutcome = "YES" | "NO";

export type PolyRewardInfo = {
  isRewardMarket: boolean;
  rewardsMinSize?: number;
  rewardsMaxSpreadCents?: number;
  competitiveness?: number;
  ratePerDayUsd?: number;
  totalRewardsUsd?: number;
};

export type PolyToken = {
  tokenId: string;
  outcome: string;
  price?: number;
};

export type PolyMarket = {
  id: string;
  conditionId: string;
  marketId?: string;
  eventId?: string;
  eventSlug?: string;
  marketSlug?: string;
  title: string;
  active: boolean;
  closed: boolean;
  endDate?: string;
  volume24h?: number;
  liquidity?: number;
  spread?: number;
  tokens: PolyToken[];
  reward: PolyRewardInfo;
  source: "gamma" | "rewards" | "merged";
  raw: unknown;
};

export type PolyBookLevel = {
  price: number;
  size: number;
};

export type PolyOrderbook = {
  tokenId: string;
  conditionId?: string;
  marketSlug?: string;
  bids: PolyBookLevel[];
  asks: PolyBookLevel[];
  bestBid?: number;
  bestAsk?: number;
  midpoint?: number;
  spread?: number;
  source: "clob_rest" | "unavailable";
  raw?: unknown;
};

export type PolyTokenBookPair = {
  yesToken?: PolyToken;
  noToken?: PolyToken;
  yesBook?: PolyOrderbook;
  noBook?: PolyOrderbook;
};

export type PolyScanResult = {
  markets: PolyMarket[];
  rewardMarkets: PolyMarket[];
  orderbooksByTokenId: Map<string, PolyOrderbook>;
  tokenBooksByConditionId: Map<string, PolyTokenBookPair>;
};

export type PolyOpportunity = {
  type: "LP_REWARD" | "SPREAD";
  conditionId: string;
  marketSlug?: string;
  title: string;
  confidence: "low" | "medium" | "high";
  classification: "OBSERVATION" | "CANDIDATE";
  reason: string;
  warnings: string[];
  reward: {
    rewardEligible: boolean;
    estimatedRewardUsdPerDay?: number;
    rewardZoneDistanceCents?: number;
  };
  spread?: {
    yesSpreadCents?: number;
    noSpreadCents?: number;
    bestSpreadCents?: number;
    bestDepthUsd?: number;
  };
};

export type PolyParityPlan = {
  type: "PARITY" | "SPLIT_MERGE";
  conditionId: string;
  marketSlug?: string;
  title: string;
  sizeShares: number;
  yesPrice: number;
  noPrice: number;
  notionalUsd: number;
  grossEdgeBps: number;
  estimatedNetEdgeBps: number;
  expectedGrossPnlUsd: number;
  warnings: string[];
};
