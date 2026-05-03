export type PolyConfig = {
  gammaBaseUrl: string;
  clobBaseUrl: string;
  maxMarketsPerScan: number;
  scanOrderbookLimit: number;
  rewardOrderbookLimit: number;
  enableRewardLane: boolean;
  enableSpreadLane: boolean;
  enableParityLane: boolean;
  minDailyRewardUsd: number;
  minRewardZoneCents: number;
  minSpreadCaptureCents: number;
  minSpreadVolumeUsd: number;
  minSpreadDepthUsd: number;
  minMidpoint: number;
  maxMidpoint: number;
  minSpreadEntryMidpoint: number;
  maxSpreadMidpoint: number;
  parityMinTradeUsd: number;
  parityMaxTradeUsd: number;
  parityMinDepthUsd: number;
  parityMinEdgeBps: number;
  paritySlippageCents: number;
  paperStateKey: string;
  paperScanIntervalMs: number;
  paperStartingBalanceUsd: number;
  paperOrderTtlSeconds: number;
  paperMinDwellSeconds: number;
  paperRewardOrderSizeUsd: number;
  paperSpreadOrderSizeUsd: number;
  paperParityOrderSizeUsd: number;
  paperMaxOpenOrdersPerLane: number;
  paperBalancedBaseFillProb: number;
  paperBalancedAgeWeight: number;
  paperViableMinFillRate: number;
  paperViableMaxMedianFillSeconds: number;
  paperViableMinPnlUsd: number;
};

function readNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (!raw) return fallback;
  return raw.toLowerCase() === "true" || raw === "1";
}

export function readPolyConfig(): PolyConfig {
  return {
    gammaBaseUrl: process.env.POLY_GAMMA_BASE_URL || "https://gamma-api.polymarket.com",
    clobBaseUrl: process.env.POLY_CLOB_BASE_URL || "https://clob.polymarket.com",
    maxMarketsPerScan: readInt("POLY_MAX_MARKETS_PER_SCAN", 120),
    scanOrderbookLimit: readInt("POLY_SCAN_ORDERBOOK_LIMIT", 120),
    rewardOrderbookLimit: readInt("POLY_REWARD_ORDERBOOK_LIMIT", 120),
    enableRewardLane: readBool("POLY_ENABLE_REWARD_LANE", true),
    enableSpreadLane: readBool("POLY_ENABLE_SPREAD_LANE", true),
    enableParityLane: readBool("POLY_ENABLE_PARITY_LANE", false),
    minDailyRewardUsd: readNumber("POLY_MIN_DAILY_REWARD_USD", 5),
    minRewardZoneCents: readNumber("POLY_MIN_REWARD_ZONE_CENTS", 2),
    minSpreadCaptureCents: readNumber("POLY_MIN_SPREAD_CAPTURE_CENTS", 1),
    minSpreadVolumeUsd: readNumber("POLY_MIN_SPREAD_VOLUME_USD", 1_000),
    minSpreadDepthUsd: readNumber("POLY_MIN_SPREAD_DEPTH_USD", 100),
    minMidpoint: readNumber("POLY_MIN_MIDPOINT", 0.05),
    maxMidpoint: readNumber("POLY_MAX_MIDPOINT", 0.95),
    minSpreadEntryMidpoint: readNumber("POLY_MIN_SPREAD_ENTRY_MIDPOINT", 0.05),
    maxSpreadMidpoint: readNumber("POLY_MAX_SPREAD_MIDPOINT", 0.97),
    parityMinTradeUsd: readNumber("POLY_PARITY_MIN_TRADE_USD", 25),
    parityMaxTradeUsd: readNumber("POLY_PARITY_MAX_TRADE_USD", 250),
    parityMinDepthUsd: readNumber("POLY_PARITY_MIN_DEPTH_USD", 25),
    parityMinEdgeBps: readNumber("POLY_PARITY_MIN_EDGE_BPS", 100),
    paritySlippageCents: readNumber("POLY_PARITY_SLIPPAGE_CENTS", 0.25),
    paperStateKey: process.env.POLY_PAPER_STATE_KEY || "poly-paper",
    paperScanIntervalMs: readInt("POLY_PAPER_SCAN_INTERVAL_MS", 15_000),
    paperStartingBalanceUsd: readNumber("POLY_PAPER_STARTING_BALANCE_USD", 1_000),
    paperOrderTtlSeconds: readInt("POLY_PAPER_ORDER_TTL_SECONDS", 45),
    paperMinDwellSeconds: readInt("POLY_PAPER_MIN_DWELL_SECONDS", 8),
    paperRewardOrderSizeUsd: readNumber("POLY_PAPER_REWARD_ORDER_SIZE_USD", 50),
    paperSpreadOrderSizeUsd: readNumber("POLY_PAPER_SPREAD_ORDER_SIZE_USD", 25),
    paperParityOrderSizeUsd: readNumber("POLY_PAPER_PARITY_ORDER_SIZE_USD", 25),
    paperMaxOpenOrdersPerLane: readInt("POLY_PAPER_MAX_OPEN_ORDERS_PER_LANE", 50),
    paperBalancedBaseFillProb: readNumber("POLY_PAPER_BALANCED_BASE_FILL_PROB", 0.2),
    paperBalancedAgeWeight: readNumber("POLY_PAPER_BALANCED_AGE_WEIGHT", 0.6),
    paperViableMinFillRate: readNumber("POLY_PAPER_VIABLE_MIN_FILL_RATE", 0.12),
    paperViableMaxMedianFillSeconds: readNumber("POLY_PAPER_VIABLE_MAX_MEDIAN_FILL_SECONDS", 120),
    paperViableMinPnlUsd: readNumber("POLY_PAPER_VIABLE_MIN_PNL_USD", -20),
  };
}
