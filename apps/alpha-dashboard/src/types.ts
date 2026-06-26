export type DashboardPositionRow = {
  marketId: string;
  marketAppId?: number;
  slug?: string;
  title: string;
  outcome: "YES" | "NO";
  shares: number;
  avgCost?: number;
  lockedUsd?: number;
  mark?: number;
  unrealisedPnl?: number;
  valueUsd?: number;
};

export type DashboardOpenOrderRow = {
  id: string;
  marketAppId: number;
  slug?: string;
  title: string;
  outcome: "YES" | "NO";
  side: "bid" | "ask";
  source: "reward" | "spread" | "inventory_exit";
  price: number;
  remainingShares: number;
  notionalUsd: number;
  createdAt: string;
  rewardEligible: boolean;
};

export type DashboardActivityItem = {
  id: string;
  type: "fill" | "cancel";
  title: string;
  outcome: "YES" | "NO";
  side: "bid" | "ask";
  price: number;
  shares: number;
  updatedAt: string;
  source: "reward" | "spread" | "inventory_exit";
  reason?: string;
};

export type DashboardSnapshot = {
  asOf: string;
  botStateKey: string;
  walletAddress?: string;
  walletBalances: {
    usdc?: number;
    algo?: number;
  };
  health: {
    cacheTtlMs: number;
    stateLastUpdated: string;
    errors: string[];
  };
  overview: {
    openOrders: number;
    bidOrders: number;
    exitOrders: number;
    rewardEligibleBidOrders: number;
    bidExposureUsd: number;
    rewardBidExposureUsd: number;
    rewardEligibleBidExposureUsd: number;
    spreadBidExposureUsd: number;
    exitNotionalUsd: number;
    rewardEligibleExitNotionalUsd: number;
    controlledExitNotionalUsd: number;
    exitPnlIfFilledUsd: number;
    realisedPlusOpenExitPnlUsd: number;
    underwaterInventoryNotionalUsd: number;
    underwaterInventoryUnrealisedLossUsd: number;
    activeRewardLiquidityShare?: number;
    potentialRewardLiquidityShare?: number;
    activeRewardRateDailyUsd?: number;
    activeRewardRateHourlyUsd?: number;
    potentialRewardRateDailyUsd?: number;
    potentialRewardRateHourlyUsd?: number;
    realisedPnl: number;
    unrealisedPnl: number;
    tradingPnl: number;
    estimatedRewardsUsd: number;
    spreadPnl: number;
    parityPnl: number;
    liveOrdersPlaced: number;
    liveOrdersCancelled: number;
  };
  positions: DashboardPositionRow[];
  openOrders: DashboardOpenOrderRow[];
  activity: DashboardActivityItem[];
  realPnl?: DashboardRealPnl;
};

export type DashboardRealPnl = {
  contributedCapitalUsd: number;
  netWorthUsd?: number;
  realPnlUsd?: number;
  walletUsdc?: number;
  bidEscrowUsd: number;
  positionsValueUsd: number;
  rewardsReceivedUsd: number;
  marketUsdcInUsd: number;
  marketUsdcOutUsd: number;
  tradingPnlUsd: number;
  estimatedRewardsUsd: number;
  externalCapitalDriftUsd: number;
  ledgerCachedAt?: string;
};
