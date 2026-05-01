export type PolyPaperModel = "conservative" | "balanced";
export type PolyPaperLane = "reward" | "spread" | "parity";
export type PolyPaperOrderSide = "bid" | "ask";
export type PolyPaperOrderStatus = "open" | "filled" | "cancelled" | "expired";

export type PolyPaperQuote = {
  id: string;
  lane: PolyPaperLane;
  conditionId: string;
  marketSlug?: string;
  title: string;
  tokenId: string;
  outcome: string;
  side: PolyPaperOrderSide;
  price: number;
  size: number;
  notionalUsd: number;
  rewardMaxSpreadCents?: number;
  parityGroupId?: string;
  parityEdgeBps?: number;
};

export type PolyPaperOrder = PolyPaperQuote & {
  createdAt: string;
  updatedAt: string;
  status: PolyPaperOrderStatus;
  filledSize: number;
  remainingSize: number;
  filledNotionalUsd: number;
  filledAt?: string;
  reservedUsd: number;
  quoteDistanceBpsSum: number;
  quoteDistanceSamples: number;
};

export type PolyPaperPosition = {
  tokenId: string;
  outcome: string;
  conditionId: string;
  marketSlug?: string;
  title: string;
  size: number;
  avgCost: number;
  realisedPnl: number;
  unrealisedPnl: number;
  lastMark?: number;
};

export type PolyPaperModelState = {
  cash: number;
  openOrders: PolyPaperOrder[];
  positionsByTokenId: Record<string, PolyPaperPosition>;
  fills: PolyPaperOrder[];
  cancelledOrders: PolyPaperOrder[];
  metrics: {
    ticks: number;
    quotesPlaced: number;
    quotesByLane: Record<PolyPaperLane, number>;
    fillsByLane: Record<PolyPaperLane, number>;
    expiredByLane: Record<PolyPaperLane, number>;
    rewardEligibleSeconds: number;
    parityAttempts: number;
    parityFilled: number;
    parityQuotedEdgeBpsSum: number;
    parityFilledEdgeBpsSum: number;
    filledCount: number;
    fillSeconds: number[];
    quoteDistanceBpsSum: number;
    quoteDistanceSamples: number;
    realisedPnl: number;
    unrealisedPnl: number;
    totalPnl: number;
  };
  lastTickAt?: string;
};

export type PolyPaperState = {
  startingBalance: number;
  conservative: PolyPaperModelState;
  balanced: PolyPaperModelState;
  lastUpdated: string;
};

export type PolyPaperReport = {
  model: PolyPaperModel;
  fillRate: number;
  medianFillSeconds?: number;
  p95FillSeconds?: number;
  cancellationRatio: number;
  quoteCompetitivenessBps?: number;
  realisedPnl: number;
  unrealisedPnl: number;
  totalPnl: number;
  rewardEligibleHours: number;
  parityConversionRate: number;
  parityEdgeDecayBps?: number;
  verdict: "viable" | "borderline" | "not_viable";
};

export type PolyPaperTickSummary = {
  model: PolyPaperModel;
  candidateQuotes: number;
  rejectedQuotes: number;
  placedTick: number;
  filledTick: number;
  expiredTick: number;
  placedTotal: number;
  fillsTotal: number;
  openOrders: number;
  openByLane: Record<PolyPaperLane, number>;
  cash: number;
  totalPnl: number;
  rewardEligibleHours: number;
  parityAttempts: number;
  parityFilled: number;
  runtimeHours: number;
  rejectReasonsTop: Array<{ reason: string; count: number }>;
};

export type PolyPaperTickResult = {
  state: PolyPaperState;
  scanMarkets: number;
  summaries: PolyPaperTickSummary[];
};
