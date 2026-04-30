import algosdk from "algosdk";

export type AlphaMode = "scan" | "paper" | "live-dry-run" | "live";

export type AlphaConfig = {
  apiKey?: string;
  algodServer: string;
  indexerServer: string;
  matcherAppId: number;
  usdcAssetId: number;
  scanOrderbookLimit: number;
  maxMarketsPerScan: number;
  scanIntervalMs: number;
  streamTimeoutMs: number;
  rewardsRequireApiKey: boolean;
  minDailyRewardUsd: number;
  minRewardZoneCents: number;
  rewardZoneBufferCents: number;
  maxRewardCompetition: "low" | "medium" | "high";
  minEdgeBps: number;
  parityBufferBps: number;
  minMakerSpreadCents: number;
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
  orderRefreshMs: number;
  staleOrderSeconds: number;
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
    algodServer: process.env.ALPHA_ALGOD_SERVER || "https://mainnet-api.algonode.cloud",
    indexerServer: process.env.ALPHA_INDEXER_SERVER || "https://mainnet-idx.algonode.cloud",
    matcherAppId: readInt("ALPHA_MATCHER_APP_ID", 3_078_581_851),
    usdcAssetId: readInt("ALPHA_USDC_ASSET_ID", 31_566_704),
    scanOrderbookLimit: readInt("ALPHA_SCAN_ORDERBOOK_LIMIT", 25),
    maxMarketsPerScan: readInt("ALPHA_MAX_MARKETS_PER_SCAN", 100),
    scanIntervalMs: readInt("ALPHA_SCAN_INTERVAL_MS", 10_000),
    streamTimeoutMs: readInt("ALPHA_STREAM_TIMEOUT_MS", 15_000),
    rewardsRequireApiKey: readBool("ALPHA_REWARDS_REQUIRE_API_KEY", false),
    minDailyRewardUsd: readNumber("ALPHA_MIN_DAILY_REWARD_USD", 1),
    minRewardZoneCents: readNumber("ALPHA_MIN_REWARD_ZONE_CENTS", 2),
    rewardZoneBufferCents: readNumber("ALPHA_REWARD_ZONE_BUFFER_CENTS", 0.5),
    maxRewardCompetition: readCompetition("ALPHA_MAX_REWARD_COMPETITION", "medium"),
    minEdgeBps: readNumber("ALPHA_MIN_EDGE_BPS", 75),
    parityBufferBps: readNumber("ALPHA_PARITY_BUFFER_BPS", 75),
    minMakerSpreadCents: readNumber("ALPHA_MIN_MAKER_SPREAD_CENTS", 4),
    minTimeToCloseMinutes: readNumber("ALPHA_MIN_TIME_TO_CLOSE_MINUTES", 60),
    maxTimeToCloseHours: readNumber("ALPHA_MAX_TIME_TO_CLOSE_HOURS", 168),
    minMidpoint: readNumber("ALPHA_MIN_MIDPOINT", 0.2),
    maxMidpoint: readNumber("ALPHA_MAX_MIDPOINT", 0.8),
    targetQuoteSizeUsd: readNumber("ALPHA_TARGET_QUOTE_SIZE_USD", 1),
    maxOrderSizeUsd: readNumber("ALPHA_MAX_ORDER_SIZE_USD", 1),
    maxMarketExposureUsd: readNumber("ALPHA_MAX_MARKET_EXPOSURE_USD", 3),
    maxTotalExposureUsd: readNumber("ALPHA_MAX_TOTAL_EXPOSURE_USD", 10),
    maxOpenOrders: readInt("ALPHA_MAX_OPEN_ORDERS", 10),
    maxLiveOpenOrders: readInt("ALPHA_MAX_LIVE_OPEN_ORDERS", 4),
    orderRefreshMs: readInt("ALPHA_ORDER_REFRESH_MS", 15_000),
    staleOrderSeconds: readInt("ALPHA_STALE_ORDER_SECONDS", 45),
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
  if (config.maxOrderSizeUsd > 1) failures.push("ALPHA_MAX_ORDER_SIZE_USD must be <= 1 for first rollout");
  if (config.maxMarketExposureUsd > 3) failures.push("ALPHA_MAX_MARKET_EXPOSURE_USD must be <= 3 for first rollout");
  if (config.maxTotalExposureUsd > 10) failures.push("ALPHA_MAX_TOTAL_EXPOSURE_USD must be <= 10 for first rollout");
  if (config.maxLiveOpenOrders > 4) failures.push("ALPHA_MAX_LIVE_OPEN_ORDERS must be <= 4 for first rollout");
  if (failures.length > 0) {
    throw new Error(`Live mode refused to start:\n- ${failures.join("\n- ")}`);
  }
}
