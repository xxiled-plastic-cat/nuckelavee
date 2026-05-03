import type { AlphaConfig, AlphaMode } from "./alphaConfig.js";
import type { AlphaBotState, AlphaQuote } from "./alphaTypes.js";

export type AlphaRiskDecision = {
  allowed: boolean;
  reason: string;
  riskLevel: "low" | "medium" | "high";
};

type QuoteLane = "reward" | "spread";

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

function laneFromSource(source: AlphaQuote["source"]): QuoteLane {
  return source === "reward" ? "reward" : "spread";
}

function laneFromQuote(quote: AlphaQuote): QuoteLane {
  return laneFromSource(quote.source);
}

function laneFromOrder(order: { source: AlphaQuote["source"] }): QuoteLane {
  return laneFromSource(order.source);
}

function laneOpenOrderCount(state: AlphaBotState, lane: QuoteLane, mode: AlphaMode): number {
  return state.openOrders.filter((order) => order.status === "open" && matchesMode(order, mode) && laneFromOrder(order) === lane).length;
}

function laneOpenOrderCountByMarket(state: AlphaBotState, lane: QuoteLane, marketId: string, mode: AlphaMode): number {
  return state.openOrders.filter(
    (order) => order.status === "open" && matchesMode(order, mode) && order.marketId === marketId && laneFromOrder(order) === lane,
  ).length;
}

function laneOrderExposure(state: AlphaBotState, lane: QuoteLane, mode: AlphaMode): number {
  return state.openOrders
    .filter((order) => order.status === "open" && matchesMode(order, mode) && laneFromOrder(order) === lane)
    .reduce((sum, order) => sum + orderExposure(order), 0);
}

function laneOrderExposureByMarket(state: AlphaBotState, lane: QuoteLane, marketId: string, mode: AlphaMode): number {
  return state.openOrders
    .filter((order) => order.status === "open" && matchesMode(order, mode) && order.marketId === marketId && laneFromOrder(order) === lane)
    .reduce((sum, order) => sum + orderExposure(order), 0);
}

export function checkQuoteRisk(
  quote: AlphaQuote,
  state: AlphaBotState,
  config: AlphaConfig,
  mode: AlphaMode,
): AlphaRiskDecision {
  const lane = laneFromQuote(quote);
  const laneMaxOrderSizeUsd = lane === "reward" ? config.rewardMaxOrderSizeUsd : config.spreadMaxOrderSizeUsd;
  const laneMaxMarketExposureUsd = lane === "reward" ? config.rewardMaxMarketExposureUsd : config.spreadMaxMarketExposureUsd;
  const laneMaxTotalExposureUsd = lane === "reward" ? config.rewardMaxTotalExposureUsd : config.spreadMaxTotalExposureUsd;
  const laneMaxLiveOpenOrders = lane === "reward" ? config.rewardMaxLiveOpenOrders : config.spreadMaxLiveOpenOrders;
  const laneMaxLiveOrdersPerMarket = lane === "reward" ? config.rewardMaxLiveOrdersPerMarket : config.spreadMaxLiveOrdersPerMarket;
  const liveLikeMode = mode === "live" || mode === "live-dry-run";

  if (quote.notionalUsd > laneMaxOrderSizeUsd) {
    return { allowed: false, reason: `${lane} order size exceeds lane cap`, riskLevel: "high" };
  }
  if (liveLikeMode && laneOpenOrderCount(state, lane, mode) >= laneMaxLiveOpenOrders) {
    return { allowed: false, reason: `${lane} lane open order count exceeds cap`, riskLevel: "high" };
  }
  if (liveLikeMode && laneOpenOrderCountByMarket(state, lane, quote.marketId, mode) >= laneMaxLiveOrdersPerMarket) {
    return { allowed: false, reason: `${lane} lane market open order count exceeds cap`, riskLevel: "medium" };
  }
  if (quote.price <= 0 || quote.price >= 1) {
    return { allowed: false, reason: "quote price outside valid range", riskLevel: "high" };
  }
  if (quote.rewardEligible === false && quote.source === "reward") {
    return { allowed: false, reason: "reward quote would sit outside reward zone", riskLevel: "medium" };
  }
  const addedExposure = quote.side === "bid" ? quote.notionalUsd : 0;
  if (laneOrderExposureByMarket(state, lane, quote.marketId, mode) + addedExposure > laneMaxMarketExposureUsd) {
    return { allowed: false, reason: `${lane} market exposure would exceed lane cap`, riskLevel: "high" };
  }
  if (laneOrderExposure(state, lane, mode) + addedExposure > laneMaxTotalExposureUsd) {
    return { allowed: false, reason: `${lane} total exposure would exceed lane cap`, riskLevel: "high" };
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
