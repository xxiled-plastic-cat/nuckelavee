import algosdk from "algosdk";

export type AlphaMode = "scan" | "paper" | "live-dry-run" | "live";

export type AlphaConfig = {
  apiKey?: string;
  algodServer: string;
  algodToken?: string;
  indexerServer: string;
  matcherAppId: number;
  usdcAssetId: number;
  scanOrderbookLimit: number;
  spreadScanOrderbookLimit: number;
  maxMarketsPerScan: number;
  scanIntervalMs: number;
  streamTimeoutMs: number;
  rewardsRequireApiKey: boolean;
  minDailyRewardUsd: number;
  minRewardZoneCents: number;
  rewardZoneBufferCents: number;
  maxRewardCompetition: "low" | "medium" | "high";
  enableRewardLane: boolean;
  rewardTargetQuoteSizeUsd: number;
  rewardMinOrderSizeUsd: number;
  rewardMaxOrderSizeUsd: number;
  rewardMaxMarketExposureUsd: number;
  rewardMaxTotalExposureUsd: number;
  rewardMaxLiveOpenOrders: number;
  rewardMaxLiveOrdersPerMarket: number;
  minEdgeBps: number;
  parityBufferBps: number;
  enableParityLane: boolean;
  enableParityArb: boolean;
  parityMinTradeUsd: number;
  parityMinEdgeBps: number;
  parityMaxTradeUsd: number;
  parityMaxDailyUsd: number;
  parityQueueLimit: number;
  paritySlotReserve: number;
  paritySlippageCents: number;
  parityMinDepthUsd: number;
  parityRequireImmediateMerge: boolean;
  minMakerSpreadCents: number;
  enableSpreadLane: boolean;
  enableSpreadCapture: boolean;
  spreadTargetOrderSizeUsd: number;
  spreadMinOrderSizeUsd: number;
  spreadMaxOrderSizeUsd: number;
  spreadOrderSizeUsd: number;
  minSpreadCaptureCents: number;
  minSpreadVolumeUsd: number;
  minSpreadDepthUsd: number;
  spreadPersistenceScans: number;
  spreadExitSlotReserve: number;
  minSpreadEntryMidpoint: number;
  minSpreadExitMidpoint: number;
  spreadEntryMinDwellSeconds: number;
  spreadExitEdgeCents: number;
  spreadExitMinDwellSeconds: number;
  maxSpreadMidpoint: number;
  spreadMaxMarketExposureUsd: number;
  spreadMaxTotalExposureUsd: number;
  spreadMaxLiveOpenOrders: number;
  spreadMaxLiveOrdersPerMarket: number;
  maxSpreadMarketExposureUsd: number;
  minTimeToCloseMinutes: number;
  maxTimeToCloseHours: number;
  minMidpoint: number;
  maxMidpoint: number;
  targetQuoteSizeUsd: number;
  maxOrderSizeUsd: number;
  maxMarketExposureUsd: number;
  maxTotalExposureUsd: number;
  maxOpenOrders: number;
  maxLiveOpenOrders: number;
  maxLiveOrdersPerMarket: number;
  quoteRefreshThresholdCents: number;
  minAlgoBalance: number;
  rewardMinDwellSeconds: number;
  orderRefreshMs: number;
  paperStartingBalanceUsd: number;
  enableLiveTrading: boolean;
  confirmRisk: boolean;
  walletAddress?: string;
  walletMnemonic?: string;
  stateKey: string;
  eventLogPath: string;
  estimatedRewardShare: number;
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

function readCompetition(key: string, fallback: AlphaConfig["maxRewardCompetition"]): AlphaConfig["maxRewardCompetition"] {
  const raw = process.env[key]?.toLowerCase();
  if (raw === "low" || raw === "medium" || raw === "high") return raw;
  return fallback;
}

export function readAlphaConfig(): AlphaConfig {
  const walletMnemonic = process.env.ALPHA_WALLET_MNEMONIC || process.env.PAYER_MNEMONIC || undefined;
  const derivedWalletAddress = walletMnemonic ? algosdk.mnemonicToSecretKey(walletMnemonic).addr.toString() : undefined;
  return {
    apiKey: process.env.ALPHA_API_KEY || undefined,
    algodServer: process.env.ALPHA_ALGOD_SERVER || "https://mainnet-api.4160.nodely.io",
    algodToken: process.env.ALGORAND_TOKEN || undefined,
    indexerServer: process.env.ALPHA_INDEXER_SERVER || "https://mainnet-idx.4160.nodely.io",
    matcherAppId: readInt("ALPHA_MATCHER_APP_ID", 3_078_581_851),
    usdcAssetId: readInt("ALPHA_USDC_ASSET_ID", 31_566_704),
    scanOrderbookLimit: readInt("ALPHA_SCAN_ORDERBOOK_LIMIT", 25),
    spreadScanOrderbookLimit: readInt("ALPHA_SPREAD_SCAN_ORDERBOOK_LIMIT", 75),
    maxMarketsPerScan: readInt("ALPHA_MAX_MARKETS_PER_SCAN", 100),
    scanIntervalMs: readInt("ALPHA_SCAN_INTERVAL_MS", 10_000),
    streamTimeoutMs: readInt("ALPHA_STREAM_TIMEOUT_MS", 15_000),
    rewardsRequireApiKey: readBool("ALPHA_REWARDS_REQUIRE_API_KEY", false),
    minDailyRewardUsd: readNumber("ALPHA_MIN_DAILY_REWARD_USD", 1),
    minRewardZoneCents: readNumber("ALPHA_MIN_REWARD_ZONE_CENTS", 2),
    rewardZoneBufferCents: readNumber("ALPHA_REWARD_ZONE_BUFFER_CENTS", 0.5),
    maxRewardCompetition: readCompetition("ALPHA_MAX_REWARD_COMPETITION", "medium"),
    enableRewardLane: readBool("ALPHA_ENABLE_REWARD_LANE", true),
    rewardTargetQuoteSizeUsd: readNumber("ALPHA_REWARD_TARGET_QUOTE_SIZE_USD", readNumber("ALPHA_TARGET_QUOTE_SIZE_USD", 3)),
    rewardMinOrderSizeUsd: readNumber("ALPHA_REWARD_MIN_ORDER_SIZE_USD", readNumber("ALPHA_TARGET_QUOTE_SIZE_USD", 3)),
    rewardMaxOrderSizeUsd: readNumber("ALPHA_REWARD_MAX_ORDER_SIZE_USD", readNumber("ALPHA_MAX_ORDER_SIZE_USD", 3)),
    rewardMaxMarketExposureUsd: readNumber("ALPHA_REWARD_MAX_MARKET_EXPOSURE_USD", readNumber("ALPHA_MAX_MARKET_EXPOSURE_USD", 6)),
    rewardMaxTotalExposureUsd: readNumber("ALPHA_REWARD_MAX_TOTAL_EXPOSURE_USD", readNumber("ALPHA_MAX_TOTAL_EXPOSURE_USD", 12)),
    rewardMaxLiveOpenOrders: readInt("ALPHA_REWARD_MAX_LIVE_OPEN_ORDERS", readInt("ALPHA_MAX_LIVE_OPEN_ORDERS", 6)),
    rewardMaxLiveOrdersPerMarket: readInt(
      "ALPHA_REWARD_MAX_LIVE_ORDERS_PER_MARKET",
      readInt("ALPHA_MAX_LIVE_ORDERS_PER_MARKET", 2),
    ),
    minEdgeBps: readNumber("ALPHA_MIN_EDGE_BPS", 75),
    parityBufferBps: readNumber("ALPHA_PARITY_BUFFER_BPS", 75),
    enableParityLane: readBool("ALPHA_ENABLE_PARITY_LANE", readBool("ALPHA_ENABLE_PARITY_ARB", false)),
    enableParityArb: readBool("ALPHA_ENABLE_PARITY_ARB", false),
    parityMinTradeUsd: readNumber("ALPHA_PARITY_MIN_TRADE_USD", readNumber("ALPHA_PARITY_MIN_DEPTH_USD", 1)),
    parityMinEdgeBps: readNumber("ALPHA_PARITY_MIN_EDGE_BPS", 150),
    parityMaxTradeUsd: readNumber("ALPHA_PARITY_MAX_TRADE_USD", 1),
    parityMaxDailyUsd: readNumber("ALPHA_PARITY_MAX_DAILY_USD", 3),
    parityQueueLimit: readInt("ALPHA_PARITY_QUEUE_LIMIT", 3),
    paritySlotReserve: readInt("ALPHA_PARITY_SLOT_RESERVE", 0),
    paritySlippageCents: readNumber("ALPHA_PARITY_SLIPPAGE_CENTS", 0.25),
    parityMinDepthUsd: readNumber("ALPHA_PARITY_MIN_DEPTH_USD", 1),
    parityRequireImmediateMerge: readBool("ALPHA_PARITY_REQUIRE_IMMEDIATE_MERGE", true),
    minMakerSpreadCents: readNumber("ALPHA_MIN_MAKER_SPREAD_CENTS", 4),
    enableSpreadLane: readBool("ALPHA_ENABLE_SPREAD_LANE", true),
    enableSpreadCapture: readBool("ALPHA_ENABLE_SPREAD_CAPTURE", true),
    spreadTargetOrderSizeUsd: readNumber("ALPHA_SPREAD_TARGET_ORDER_SIZE_USD", readNumber("ALPHA_SPREAD_ORDER_SIZE_USD", 1)),
    spreadMinOrderSizeUsd: readNumber("ALPHA_SPREAD_MIN_ORDER_SIZE_USD", readNumber("ALPHA_SPREAD_ORDER_SIZE_USD", 1)),
    spreadMaxOrderSizeUsd: readNumber("ALPHA_SPREAD_MAX_ORDER_SIZE_USD", readNumber("ALPHA_MAX_ORDER_SIZE_USD", 3)),
    spreadOrderSizeUsd: readNumber("ALPHA_SPREAD_TARGET_ORDER_SIZE_USD", readNumber("ALPHA_SPREAD_ORDER_SIZE_USD", 1)),
    minSpreadCaptureCents: readNumber("ALPHA_MIN_SPREAD_CAPTURE_CENTS", 1),
    minSpreadVolumeUsd: readNumber("ALPHA_MIN_SPREAD_VOLUME_USD", 1),
    minSpreadDepthUsd: readNumber("ALPHA_MIN_SPREAD_DEPTH_USD", 0.25),
    spreadPersistenceScans: readInt("ALPHA_SPREAD_PERSISTENCE_SCANS", 2),
    spreadExitSlotReserve: readInt("ALPHA_SPREAD_EXIT_SLOT_RESERVE", 2),
    minSpreadEntryMidpoint: readNumber("ALPHA_MIN_SPREAD_ENTRY_MIDPOINT", 0.05),
    minSpreadExitMidpoint: readNumber("ALPHA_MIN_SPREAD_EXIT_MIDPOINT", 0.01),
    spreadEntryMinDwellSeconds: readInt("ALPHA_SPREAD_ENTRY_MIN_DWELL_SECONDS", 600),
    spreadExitEdgeCents: readNumber("ALPHA_SPREAD_EXIT_EDGE_CENTS", 1),
    spreadExitMinDwellSeconds: readInt("ALPHA_SPREAD_EXIT_MIN_DWELL_SECONDS", 1_800),
    maxSpreadMidpoint: readNumber("ALPHA_MAX_SPREAD_MIDPOINT", 0.99),
    spreadMaxMarketExposureUsd: readNumber(
      "ALPHA_SPREAD_MAX_MARKET_EXPOSURE_USD",
      readNumber("ALPHA_MAX_SPREAD_MARKET_EXPOSURE_USD", 2),
    ),
    spreadMaxTotalExposureUsd: readNumber("ALPHA_SPREAD_MAX_TOTAL_EXPOSURE_USD", readNumber("ALPHA_MAX_TOTAL_EXPOSURE_USD", 12)),
    spreadMaxLiveOpenOrders: readInt("ALPHA_SPREAD_MAX_LIVE_OPEN_ORDERS", readInt("ALPHA_MAX_LIVE_OPEN_ORDERS", 6)),
    spreadMaxLiveOrdersPerMarket: readInt(
      "ALPHA_SPREAD_MAX_LIVE_ORDERS_PER_MARKET",
      readInt("ALPHA_MAX_LIVE_ORDERS_PER_MARKET", 2),
    ),
    maxSpreadMarketExposureUsd: readNumber("ALPHA_MAX_SPREAD_MARKET_EXPOSURE_USD", 2),
    minTimeToCloseMinutes: readNumber("ALPHA_MIN_TIME_TO_CLOSE_MINUTES", 60),
    maxTimeToCloseHours: readNumber("ALPHA_MAX_TIME_TO_CLOSE_HOURS", 168),
    minMidpoint: readNumber("ALPHA_MIN_MIDPOINT", 0.2),
    maxMidpoint: readNumber("ALPHA_MAX_MIDPOINT", 0.8),
    targetQuoteSizeUsd: readNumber("ALPHA_TARGET_QUOTE_SIZE_USD", 3),
    maxOrderSizeUsd: readNumber("ALPHA_MAX_ORDER_SIZE_USD", 3),
    maxMarketExposureUsd: readNumber("ALPHA_MAX_MARKET_EXPOSURE_USD", 6),
    maxTotalExposureUsd: readNumber("ALPHA_MAX_TOTAL_EXPOSURE_USD", 12),
    maxOpenOrders: readInt("ALPHA_MAX_OPEN_ORDERS", 10),
    maxLiveOpenOrders: readInt("ALPHA_MAX_LIVE_OPEN_ORDERS", 6),
    maxLiveOrdersPerMarket: readInt("ALPHA_MAX_LIVE_ORDERS_PER_MARKET", 2),
    quoteRefreshThresholdCents: readNumber("ALPHA_QUOTE_REFRESH_THRESHOLD_CENTS", 1),
    minAlgoBalance: readNumber("ALPHA_MIN_ALGO_BALANCE", 3),
    rewardMinDwellSeconds: readInt("ALPHA_REWARD_MIN_DWELL_SECONDS", 180),
    orderRefreshMs: readInt("ALPHA_ORDER_REFRESH_MS", 15_000),
    paperStartingBalanceUsd: readNumber("ALPHA_PAPER_STARTING_BALANCE_USD", 50),
    enableLiveTrading: readBool("ALPHA_ENABLE_LIVE_TRADING", false),
    confirmRisk: readBool("ALPHA_CONFIRM_RISK", false),
    walletAddress: process.env.ALPHA_WALLET_ADDRESS || derivedWalletAddress,
    walletMnemonic,
    stateKey: process.env.ALPHA_STATE_KEY || "alpha",
    eventLogPath: process.env.ALPHA_EVENT_LOG_PATH || "logs/alpha-paper-events.jsonl",
    estimatedRewardShare: readNumber("ALPHA_ESTIMATED_REWARD_SHARE", 0.01),
  };
}

export function validateLiveConfig(config: AlphaConfig): void {
  const failures: string[] = [];
  if (!config.enableLiveTrading) failures.push("ALPHA_ENABLE_LIVE_TRADING must be true");
  if (!config.confirmRisk) failures.push("ALPHA_CONFIRM_RISK must be true");
  if (!config.walletAddress) failures.push("ALPHA_WALLET_ADDRESS or a mnemonic-derived address is required");
  if (!config.walletMnemonic) failures.push("ALPHA_WALLET_MNEMONIC or PAYER_MNEMONIC is required");
  if (failures.length > 0) {
    throw new Error(`Live mode refused to start:\n- ${failures.join("\n- ")}`);
  }
}
