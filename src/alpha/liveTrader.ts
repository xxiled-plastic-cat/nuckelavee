import type { AlphaConfig, AlphaMode } from "./alphaConfig.js";
import { validateLiveConfig } from "./alphaConfig.js";
import { AlphaSdkClient } from "./alphaClient.js";
import { checkQuoteRisk } from "./alphaRiskManager.js";
import { loadAlphaState, saveAlphaState } from "./alphaStateStore.js";
import type { AlphaBotState, AlphaMarket, AlphaPaperOrder, AlphaQuote } from "./alphaTypes.js";
import type { AlphaScanResult } from "./alphaMarketScanner.js";
import { generateQuotes } from "./quoteEngine.js";

export type LiveAction = {
  kind: "place" | "cancel" | "skip";
  message: string;
};

export type LiveTickResult = {
  actions: LiveAction[];
  state: AlphaBotState;
  walletUsdcBalanceUsd?: number;
};

function toTrackedLiveOrder(quote: AlphaQuote, result: { escrowAppId: number; txIds: string[] }): AlphaPaperOrder {
  const now = new Date().toISOString();
  return {
    ...quote,
    id: `live:${result.escrowAppId}`,
    runMode: "live",
    createdAt: now,
    updatedAt: now,
    status: "open",
    reservedUsd: quote.side === "bid" ? quote.notionalUsd : 0,
    filledShares: 0,
    remainingShares: quote.sizeShares,
    liveEscrowAppId: result.escrowAppId,
    liveTxIds: result.txIds,
  };
}

export async function runLiveTick(
  scan: AlphaScanResult,
  config: AlphaConfig,
  mode: Extract<AlphaMode, "live-dry-run" | "live">,
): Promise<LiveTickResult> {
  if (mode === "live") validateLiveConfig(config);
  if (!config.walletAddress) throw new Error(`${mode} requires ALPHA_WALLET_ADDRESS or mnemonic-derived address`);

  const state = await loadAlphaState(config.stateKey, config.paperStartingBalanceUsd);
  const liveClient = new AlphaSdkClient(config, mode === "live");
  const walletUsdcBalanceUsd = await liveClient.getUsdcBalance(config.walletAddress);
  const actions: LiveAction[] = [];
  const marketByAppId = new Map<number, AlphaMarket>();
  for (const market of [...scan.markets, ...scan.rewardMarkets]) {
    marketByAppId.set(market.marketAppId, market);
  }

  for (const order of state.openOrders.filter((candidate) => candidate.status === "open" && candidate.liveEscrowAppId !== undefined)) {
    const escrowAppId = order.liveEscrowAppId;
    if (escrowAppId === undefined) continue;
    const ageSeconds = (Date.now() - Date.parse(order.createdAt)) / 1000;
    if (ageSeconds < config.staleOrderSeconds) continue;
    if (mode === "live-dry-run") {
      actions.push({ kind: "cancel", message: `Would cancel stale live order escrowAppId=${escrowAppId}` });
      continue;
    }
    const result = await liveClient.cancelOrder({
      marketAppId: order.marketAppId,
      escrowAppId,
      orderOwner: config.walletAddress,
    });
    if (result.success) {
      order.status = "cancelled";
      order.updatedAt = new Date().toISOString();
      state.cancelledOrders.push({ ...order });
      state.strategyStats.liveOrdersCancelled += 1;
      actions.push({ kind: "cancel", message: `Cancelled stale live order escrowAppId=${escrowAppId}` });
    }
  }
  state.openOrders = state.openOrders.filter((order) => order.status === "open");

  const openLiveOrders = state.openOrders.filter((order) => order.status === "open" && order.liveEscrowAppId !== undefined);
  const slots = Math.max(0, config.maxLiveOpenOrders - openLiveOrders.length);
  if (slots === 0) {
    actions.push({ kind: "skip", message: "No live order slots available under ALGO MBR-aware cap" });
    return { actions, state, walletUsdcBalanceUsd };
  }

  const quotes: AlphaQuote[] = [];
  for (const market of marketByAppId.values()) {
    const book = scan.orderbooks.get(market.marketAppId);
    if (!book) continue;
    quotes.push(...generateQuotes(market, book, state, config));
  }

  for (const quote of quotes.slice(0, slots)) {
    const risk = checkQuoteRisk(quote, state, config, mode);
    if (!risk.allowed) {
      actions.push({ kind: "skip", message: `${quote.title} ${quote.outcome} ${quote.side}: ${risk.reason}` });
      continue;
    }
    if (mode === "live-dry-run") {
      actions.push({
        kind: "place",
        message: `Would place ${quote.title} ${quote.outcome} ${quote.side} ${quote.price.toFixed(3)} size $${quote.notionalUsd.toFixed(
          2,
        )} / ${quote.sizeShares.toFixed(6)} shares`,
      });
      continue;
    }
    if (quote.side !== "bid") {
      actions.push({ kind: "skip", message: `${quote.title} ${quote.outcome} ask skipped in first rollout unless manually reviewed` });
      continue;
    }
    const result = await liveClient.createLimitOrder({
      marketAppId: quote.marketAppId,
      outcome: quote.outcome,
      price: quote.price,
      sizeShares: quote.sizeShares,
      isBuying: true,
    });
    state.openOrders.push(toTrackedLiveOrder(quote, result));
    state.strategyStats.liveOrdersPlaced += 1;
    actions.push({ kind: "place", message: `Placed ${quote.title} escrowAppId=${result.escrowAppId}` });
  }
  state.strategyStats.lastRunMode = mode;
  if (mode === "live") await saveAlphaState(config.stateKey, state);
  return { actions, state, walletUsdcBalanceUsd };
}
