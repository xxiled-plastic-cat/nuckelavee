export type AlphaOutcome = "YES" | "NO";
export type AlphaOrderSide = "bid" | "ask";
export type AlphaOrderStatus = "open" | "filled" | "cancelled" | "expired";
export type AlphaOrderbookSource = "api" | "onchain_orderbook" | "unavailable";

export type AlphaRewardInfo = {
  isRewardMarket: boolean;
  totalRewardsUsd?: number;
  rewardsPaidOutUsd?: number;
  remainingRewardsUsd?: number;
  dailyRewardsUsd?: number;
  lastPayoutUsd?: number;
  maxRewardSpreadCents?: number;
  minContracts?: number;
  competitionLevel?: "low" | "medium" | "high" | "unknown";
};

export type AlphaMarket = {
  id: string;
  marketAppId: number;
  slug?: string;
  title: string;
  category?: string;
  status: string;
  closeTime?: string;
  endTs?: number;
  resolved: boolean;
  yesPrice?: number;
  noPrice?: number;
  volume?: number;
  liquidity?: number;
  reward: AlphaRewardInfo;
  raw: unknown;
};

export type AlphaBookLevel = {
  price: number;
  quantityShares: number;
  escrowAppId?: number;
  owner?: string;
};

export type AlphaOrderbook = {
  marketId: string;
  marketAppId: number;
  slug?: string;
  source: AlphaOrderbookSource;
  yesBid?: number;
  yesAsk?: number;
  noBid?: number;
  noAsk?: number;
  yesMid?: number;
  noMid?: number;
  yesSpread?: number;
  noSpread?: number;
  bestSpread?: number;
  yesSideOrders: {
    bids: AlphaBookLevel[];
    asks: AlphaBookLevel[];
  };
  noSideOrders: {
    bids: AlphaBookLevel[];
    asks: AlphaBookLevel[];
  };
  raw?: unknown;
};

export type AlphaQuote = {
  id: string;
  marketId: string;
  marketAppId: number;
  slug?: string;
  title: string;
  outcome: AlphaOutcome;
  side: AlphaOrderSide;
  price: number;
  sizeShares: number;
  notionalUsd: number;
  reason: string;
  rewardEligible: boolean;
  rewardZoneDistanceCents?: number;
  estimatedRewardUsdPerDay?: number;
  source: "reward" | "spread" | "inventory_exit";
};

export type AlphaPaperOrder = AlphaQuote & {
  runMode?: "paper" | "live";
  createdAt: string;
  updatedAt: string;
  status: AlphaOrderStatus;
  reservedUsd: number;
  filledShares: number;
  remainingShares: number;
  liveEscrowAppId?: number;
  liveTxIds?: string[];
};

export type AlphaPaperPosition = {
  marketId: string;
  slug?: string;
  title: string;
  yesShares: number;
  noShares: number;
  avgYesCost: number;
  avgNoCost: number;
  realisedPnl: number;
  unrealisedPnl: number;
  lastMark?: number;
};

export type AlphaBotState = {
  startingBalance: number;
  cash: number;
  openOrders: AlphaPaperOrder[];
  positionsByMarket: Record<string, AlphaPaperPosition>;
  realisedPnl: number;
  unrealisedPnl: number;
  estimatedRewardsUsd: number;
  estimatedRewardsByMarket: Record<string, number>;
  rewardEligibleSeconds: number;
  totalPnl: number;
  fills: AlphaPaperOrder[];
  cancelledOrders: AlphaPaperOrder[];
  strategyStats: {
    ticks: number;
    rewardMarketsSeen: number;
    candidatesSeen: number;
    quotesPlaced: number;
    liveOrdersPlaced: number;
    liveOrdersCancelled: number;
    lastRunMode?: string;
  };
  lastUpdated: string;
};

export type AlphaOpportunity = {
  type: "LP_REWARD" | "MAKER" | "PARITY" | "SPLIT_MERGE";
  marketId: string;
  marketAppId: number;
  slug?: string;
  title: string;
  edgeBps?: number;
  confidence: "low" | "medium" | "high";
  classification: "OBSERVATION" | "CANDIDATE" | "MECHANICAL" | "DANGER";
  reason: string;
  requiredAction: string;
  warnings: string[];
  reward: {
    rewardEligible: boolean;
    estimatedRewardUsdPerHour?: number;
    estimatedRewardUsdPerDay?: number;
    rewardZoneDistanceCents?: number;
    competitionLevel?: AlphaRewardInfo["competitionLevel"];
    rewardReason?: string;
  };
};
