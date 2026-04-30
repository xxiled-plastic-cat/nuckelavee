import type { AlphaConfig, AlphaMode } from "./alphaConfig.js";
import type { AlphaBotState, AlphaQuote } from "./alphaTypes.js";

export type AlphaRiskDecision = {
  allowed: boolean;
  reason: string;
  riskLevel: "low" | "medium" | "high";
};

function orderExposure(order: { side: string; price: number; remainingShares: number }): number {
  return order.side === "bid" ? order.price * order.remainingShares : 0;
}

function matchesMode(order: { runMode?: "paper" | "live" }, mode: AlphaMode): boolean {
  const orderMode = order.runMode ?? "paper";
  if (mode === "live" || mode === "live-dry-run") return orderMode === "live";
  return orderMode === "paper";
}

export function getMarketExposure(state: AlphaBotState, marketId: string, mode: AlphaMode = "paper"): number {
  const orderExposureUsd = state.openOrders
    .filter((order) => order.marketId === marketId && order.status === "open" && matchesMode(order, mode))
    .reduce((sum, order) => sum + orderExposure(order), 0);
  if (mode === "live" || mode === "live-dry-run") return orderExposureUsd;
  const position = state.positionsByMarket[marketId];
  if (!position) return orderExposureUsd;
  return orderExposureUsd + position.yesShares * position.avgYesCost + position.noShares * position.avgNoCost;
}

export function getTotalExposure(state: AlphaBotState, mode: AlphaMode = "paper"): number {
  const orderExposureUsd = state.openOrders
    .filter((order) => order.status === "open" && matchesMode(order, mode))
    .reduce((sum, order) => sum + orderExposure(order), 0);
  if (mode === "live" || mode === "live-dry-run") return orderExposureUsd;
  const positionExposure = Object.values(state.positionsByMarket).reduce(
    (sum, position) => sum + position.yesShares * position.avgYesCost + position.noShares * position.avgNoCost,
    0,
  );
  return orderExposureUsd + positionExposure;
}

function openAskShares(state: AlphaBotState, marketId: string, outcome: "YES" | "NO", mode: AlphaMode): number {
  return state.openOrders
    .filter(
      (order) =>
        order.marketId === marketId &&
        order.outcome === outcome &&
        order.side === "ask" &&
        order.status === "open" &&
        matchesMode(order, mode),
    )
    .reduce((sum, order) => sum + order.remainingShares, 0);
}

export function checkQuoteRisk(
  quote: AlphaQuote,
  state: AlphaBotState,
  config: AlphaConfig,
  mode: AlphaMode,
): AlphaRiskDecision {
  if (quote.notionalUsd > config.maxOrderSizeUsd) {
    return { allowed: false, reason: "order size exceeds max order size", riskLevel: "high" };
  }
  if (state.openOrders.filter((order) => order.status === "open" && matchesMode(order, mode)).length >= config.maxOpenOrders) {
    return { allowed: false, reason: "open order count exceeds cap", riskLevel: "medium" };
  }
  if (mode === "live" && state.openOrders.filter((order) => order.status === "open" && matchesMode(order, mode)).length >= config.maxLiveOpenOrders) {
    return { allowed: false, reason: "live open order count exceeds ALGO MBR-aware cap", riskLevel: "high" };
  }
  if (quote.price <= 0 || quote.price >= 1) {
    return { allowed: false, reason: "quote price outside valid range", riskLevel: "high" };
  }
  if (quote.rewardEligible === false && quote.source === "reward") {
    return { allowed: false, reason: "reward quote would sit outside reward zone", riskLevel: "medium" };
  }
  const addedExposure = quote.side === "bid" ? quote.notionalUsd : 0;
  if (getMarketExposure(state, quote.marketId, mode) + addedExposure > config.maxMarketExposureUsd) {
    return { allowed: false, reason: "market exposure would exceed cap", riskLevel: "high" };
  }
  if (quote.source === "spread" && getMarketExposure(state, quote.marketId, mode) + addedExposure > config.maxSpreadMarketExposureUsd) {
    return { allowed: false, reason: "spread market exposure would exceed cap", riskLevel: "medium" };
  }
  if (getTotalExposure(state, mode) + addedExposure > config.maxTotalExposureUsd) {
    return { allowed: false, reason: "total exposure would exceed cap", riskLevel: "high" };
  }
  if (mode === "paper" && quote.side === "bid" && quote.notionalUsd > state.cash) {
    return { allowed: false, reason: "bid requires more cash than available", riskLevel: "high" };
  }
  if (quote.side === "ask") {
    const position = state.positionsByMarket[quote.marketId];
    const held = quote.outcome === "YES" ? position?.yesShares ?? 0 : position?.noShares ?? 0;
    if (quote.sizeShares + openAskShares(state, quote.marketId, quote.outcome, mode) > held) {
      return { allowed: false, reason: "ask would sell more shares than current inventory", riskLevel: "high" };
    }
  }
  return { allowed: true, reason: "quote passed risk checks", riskLevel: "low" };
}
