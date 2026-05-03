import type { AlphaConfig, AlphaMode } from "./alphaConfig.js";
import { AlphaSdkClient } from "./alphaClient.js";
import { scanParity } from "./alphaParityScanner.js";
import type { AlphaBotState, AlphaMarket, AlphaOrderbook, AlphaParityAttempt, AlphaParityPlan } from "./alphaTypes.js";
import type { AlphaScanResult } from "./alphaMarketScanner.js";

type ParityAction = {
  kind: "parity" | "skip";
  message: string;
};

type ParityMode = Extract<AlphaMode, "live-dry-run" | "live">;

function attempt(plan: AlphaParityPlan, mode: ParityMode, status: AlphaParityAttempt["status"], reason?: string, txIds: string[] = []): AlphaParityAttempt {
  return {
    ...plan,
    id: `parity:${plan.marketAppId}:${plan.type}:${Date.now()}`,
    mode,
    status,
    reason,
    txIds,
    createdAt: new Date().toISOString(),
  };
}

function dailyParityUsd(state: AlphaBotState): number {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return state.parityAttempts
    .filter((entry) => entry.status === "executed" && Date.parse(entry.createdAt) >= cutoff)
    .reduce((sum, entry) => sum + entry.notionalUsd, 0);
}

function recordSkipped(state: AlphaBotState, plan: AlphaParityPlan, mode: ParityMode, reason: string): void {
  state.parityAttempts.push(attempt(plan, mode, "skipped", reason));
}

function recordExecuted(state: AlphaBotState, plan: AlphaParityPlan, mode: ParityMode, txIds: string[]): void {
  state.parityAttempts.push(attempt(plan, mode, "executed", undefined, txIds));
  state.strategyStats.parityTradesExecuted += 1;
  state.strategyStats.parityGrossPnl += plan.expectedGrossPnlUsd;
  state.strategyStats.parityNetPnlEstimate += (plan.estimatedNetEdgeBps / 10_000) * plan.sizeShares;
  state.strategyStats.lastParityTradeAt = new Date().toISOString();
}

function recordFailed(state: AlphaBotState, plan: AlphaParityPlan, mode: ParityMode, reason: string, txIds: string[] = []): void {
  state.parityAttempts.push(attempt(plan, mode, "failed", reason, txIds));
  state.strategyStats.parityFailedLegs += 1;
}

function planMessage(prefix: string, plan: AlphaParityPlan): string {
  const action = plan.type === "PARITY" ? "buy YES/NO then merge" : "split then sell YES/NO";
  return `${prefix} ${action} ${plan.title}: YES=${plan.yesPrice.toFixed(3)} NO=${plan.noPrice.toFixed(3)} size=${plan.sizeShares.toFixed(
    6,
  )} expectedGross=${formatUsd(plan.expectedGrossPnlUsd)} netEdge=${plan.estimatedNetEdgeBps.toFixed(0)}bps`;
}

function formatUsd(value: number): string {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(4)}`;
}

function validatePlan(
  plan: AlphaParityPlan,
  state: AlphaBotState,
  config: AlphaConfig,
): string | undefined {
  if (plan.notionalUsd < config.parityMinTradeUsd) {
    return `trade notional $${plan.notionalUsd.toFixed(2)} below parity minimum $${config.parityMinTradeUsd.toFixed(2)}`;
  }
  if (plan.notionalUsd > config.parityMaxTradeUsd) {
    return `trade notional $${plan.notionalUsd.toFixed(2)} exceeds parity maximum $${config.parityMaxTradeUsd.toFixed(2)}`;
  }
  if (plan.notionalUsd < config.parityMinDepthUsd) {
    return `depth $${plan.notionalUsd.toFixed(2)} below parity minimum $${config.parityMinDepthUsd.toFixed(2)}`;
  }
  if (plan.estimatedNetEdgeBps < config.parityMinEdgeBps) {
    return `net edge ${plan.estimatedNetEdgeBps.toFixed(0)}bps below minimum ${config.parityMinEdgeBps.toFixed(0)}bps`;
  }
  if (dailyParityUsd(state) + plan.notionalUsd > config.parityMaxDailyUsd) {
    return `daily parity notional cap would exceed $${config.parityMaxDailyUsd.toFixed(2)}`;
  }
  return undefined;
}

async function refreshPlan(
  liveClient: AlphaSdkClient,
  market: AlphaMarket,
  config: AlphaConfig,
  type: AlphaParityPlan["type"],
): Promise<AlphaParityPlan | undefined> {
  const book = await liveClient.getOrderbook(market);
  const plans = scanParity([market], new Map<number, AlphaOrderbook>([[market.marketAppId, book]]), config);
  return plans.find((plan) => plan.type === type);
}

async function executeBuyMerge(
  liveClient: AlphaSdkClient,
  plan: AlphaParityPlan,
  config: AlphaConfig,
): Promise<string[]> {
  const slippage = config.paritySlippageCents / 100;
  const yes = await liveClient.createMarketOrder({
    marketAppId: plan.marketAppId,
    outcome: "YES",
    price: plan.yesPrice,
    sizeShares: plan.sizeShares,
    isBuying: true,
    slippage,
  });
  const no = await liveClient.createMarketOrder({
    marketAppId: plan.marketAppId,
    outcome: "NO",
    price: plan.noPrice,
    sizeShares: plan.sizeShares,
    isBuying: true,
    slippage,
  });
  const merge = await liveClient.mergeShares({ marketAppId: plan.marketAppId, amountShares: plan.sizeShares });
  return [...yes.txIds, ...no.txIds, ...merge.txIds];
}

async function executeSplitSell(
  liveClient: AlphaSdkClient,
  plan: AlphaParityPlan,
  config: AlphaConfig,
): Promise<string[]> {
  const slippage = config.paritySlippageCents / 100;
  const split = await liveClient.splitShares({ marketAppId: plan.marketAppId, amountUsd: plan.sizeShares });
  const yes = await liveClient.createMarketOrder({
    marketAppId: plan.marketAppId,
    outcome: "YES",
    price: plan.yesPrice,
    sizeShares: plan.sizeShares,
    isBuying: false,
    slippage,
  });
  const no = await liveClient.createMarketOrder({
    marketAppId: plan.marketAppId,
    outcome: "NO",
    price: plan.noPrice,
    sizeShares: plan.sizeShares,
    isBuying: false,
    slippage,
  });
  return [...split.txIds, ...yes.txIds, ...no.txIds];
}

export async function runParityLane(input: {
  scan: AlphaScanResult;
  state: AlphaBotState;
  config: AlphaConfig;
  liveClient: AlphaSdkClient;
  mode: ParityMode;
}): Promise<ParityAction[]> {
  const { scan, state, config, liveClient, mode } = input;
  if (!config.enableParityLane) {
    return [{ kind: "skip", message: "Parity lane disabled (ALPHA_ENABLE_PARITY_LANE=false)" }];
  }
  const marketByAppId = new Map([...scan.markets, ...scan.rewardMarkets].map((market) => [market.marketAppId, market]));
  const plans = scanParity([...marketByAppId.values()], scan.orderbooks, config);
  const actions: ParityAction[] = [];
  if (plans.length === 0) {
    actions.push({ kind: "skip", message: "Parity: no executable depth-aware candidates" });
    return actions;
  }

  actions.push({ kind: "parity", message: `Parity: ${plans.length} executable candidate(s) detected` });
  const planWindow = plans.slice(0, Math.max(1, config.parityQueueLimit));
  for (const plan of planWindow) {
    const rejection = validatePlan(plan, state, config);
    if (rejection) {
      recordSkipped(state, plan, mode, rejection);
      actions.push({ kind: "skip", message: `Skipped parity ${plan.title}: ${rejection}` });
      continue;
    }
    if (mode === "live-dry-run") {
      state.parityAttempts.push(attempt(plan, mode, "planned", "dry-run"));
      actions.push({ kind: "parity", message: planMessage("Would", plan) });
      return actions;
    }
    if (!config.enableParityArb) {
      recordSkipped(state, plan, mode, "parity arb disabled");
      actions.push({ kind: "skip", message: `Skipped parity ${plan.title}: ALPHA_ENABLE_PARITY_ARB=false` });
      continue;
    }

    const market = marketByAppId.get(plan.marketAppId);
    if (!market) {
      recordSkipped(state, plan, mode, "market metadata unavailable");
      actions.push({ kind: "skip", message: `Skipped parity ${plan.title}: market metadata unavailable` });
      continue;
    }
    try {
      const refreshed = await refreshPlan(liveClient, market, config, plan.type);
      if (!refreshed) {
        recordSkipped(state, plan, mode, "candidate disappeared after orderbook refresh");
        actions.push({ kind: "skip", message: `Skipped parity ${plan.title}: candidate disappeared after refresh` });
        continue;
      }
      const txIds = refreshed.type === "PARITY" ? await executeBuyMerge(liveClient, refreshed, config) : await executeSplitSell(liveClient, refreshed, config);
      recordExecuted(state, refreshed, mode, txIds);
      actions.push({ kind: "parity", message: planMessage("Executed", refreshed) });
      return actions;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      recordFailed(state, plan, mode, reason);
      actions.push({ kind: "skip", message: `Parity failed ${plan.title}: ${reason}` });
      return actions;
    }
  }
  return actions;
}
