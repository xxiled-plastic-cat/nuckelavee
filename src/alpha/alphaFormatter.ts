import type { AlphaBotState, AlphaMarket, AlphaOpportunity, AlphaOrderbook } from "./alphaTypes.js";
import { summarizeBooks, type AlphaScanResult } from "./alphaMarketScanner.js";

export function fmtUsd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "unknown";
  const sign = value > 0 ? "+" : "";
  return `${sign}$${value.toFixed(2)}`;
}

export function fmtPrice(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "-" : value.toFixed(3);
}

export function fmtCents(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "unknown" : `${(value * 100).toFixed(2)}c`;
}

export function printScan(scan: AlphaScanResult, rewardCandidates: AlphaOpportunity[], parity: AlphaOpportunity[]): void {
  const surface = summarizeBooks(scan.orderbooks.values());
  console.log("NUCKELAVEE / ALPHA ARCADE");
  console.log("");
  console.log(`Markets loaded: ${scan.markets.length}`);
  console.log(`Reward markets loaded: ${scan.rewardMarkets.length}`);
  if (scan.rewardError) console.log(`Reward metadata warning: ${scan.rewardError}`);
  console.log(`Orderbooks scanned: ${scan.orderbooks.size}`);
  console.log("");
  console.log("Market surface:");
  console.log(`- two-sided books: ${surface.twoSided}`);
  console.log(`- one-sided books: ${surface.oneSided}`);
  console.log(`- empty books: ${surface.empty}`);
  console.log(`- avg spread: ${fmtCents(surface.averageSpread)}`);
  console.log("");
  console.log("Top LP reward candidates:");
  for (const candidate of rewardCandidates.slice(0, 8)) {
    console.log(
      `- ${candidate.title} daily=${fmtUsd(candidate.reward.estimatedRewardUsdPerDay)} zone=${
        candidate.reward.rewardZoneDistanceCents?.toFixed(2) ?? "unknown"
      }c competition=${candidate.reward.competitionLevel ?? "unknown"}`,
    );
  }
  if (rewardCandidates.length === 0) console.log("- none");
  console.log("");
  console.log(`Parity / split-merge candidates: ${parity.length}`);
}

export function printRewards(rewardMarkets: AlphaMarket[], candidates: AlphaOpportunity[], rewardError?: string): void {
  console.log("NUCKELAVEE / ALPHA REWARDS");
  console.log("");
  if (rewardError) console.log(`Reward metadata warning: ${rewardError}`);
  console.log(`Reward markets loaded: ${rewardMarkets.length}`);
  console.log("");
  for (const candidate of candidates.slice(0, 12)) {
    console.log("[LP REWARD CANDIDATE]");
    console.log(`Market: ${candidate.title}`);
    if (candidate.slug) console.log(`Slug: ${candidate.slug}`);
    console.log(`Daily rewards: ${fmtUsd(candidate.reward.estimatedRewardUsdPerDay)}`);
    console.log(`Competition: ${candidate.reward.competitionLevel ?? "unknown"}`);
    console.log(`Max reward spread: ${candidate.reward.rewardZoneDistanceCents?.toFixed(2) ?? "unknown"}c`);
    console.log(`Reason: ${candidate.reason}`);
    if (candidate.warnings.length > 0) console.log(`Warnings: ${candidate.warnings.join("; ")}`);
    console.log("");
  }
}

export function printMarketDetail(market: AlphaMarket, book: AlphaOrderbook | undefined): void {
  console.log("ALPHA MARKET DETAIL");
  console.log("");
  console.log(`Title: ${market.title}`);
  console.log(`Market app ID: ${market.marketAppId}`);
  if (market.slug) console.log(`Slug: ${market.slug}`);
  console.log(`Status: ${market.status}`);
  console.log(`Close: ${market.closeTime ?? "unknown"}`);
  console.log("");
  console.log(`LP rewards: ${market.reward.isRewardMarket ? "yes" : "no"}`);
  console.log(`Daily rewards: ${fmtUsd(market.reward.dailyRewardsUsd)}`);
  console.log(`Max reward spread: ${market.reward.maxRewardSpreadCents?.toFixed(2) ?? "unknown"}c`);
  console.log(`Competition: ${market.reward.competitionLevel ?? "unknown"}`);
  console.log("");
  if (!book) {
    console.log("Orderbook unavailable");
    return;
  }
  console.log(`Orderbook source: ${book.source}`);
  console.log(`YES bid/ask: ${fmtPrice(book.yesBid)} / ${fmtPrice(book.yesAsk)}`);
  console.log(`NO bid/ask: ${fmtPrice(book.noBid)} / ${fmtPrice(book.noAsk)}`);
  console.log(`Best spread: ${fmtCents(book.bestSpread)}`);
}

export function printPaperWatch(state: AlphaBotState): void {
  const open = state.openOrders.filter((order) => order.status === "open");
  const rewardEligible = open.filter((order) => order.rewardEligible).length;
  console.log(
    `[${new Date().toISOString().slice(11, 19)}] openOrders=${open.length} rewardEligible=${rewardEligible} fills=${
      state.fills.length
    } cash=$${state.cash.toFixed(2)} tradingPnl=${fmtUsd(state.totalPnl)} estRewards=${fmtUsd(state.estimatedRewardsUsd)}`,
  );
}

export function printLiveSummary(state: AlphaBotState, walletUsdcBalanceUsd?: number): void {
  const open = state.openOrders.filter((order) => order.status === "open" && order.runMode === "live");
  const rewardEligible = open.filter((order) => order.rewardEligible).length;
  const exposure = open.reduce((sum, order) => sum + (order.side === "bid" ? order.price * order.remainingShares : 0), 0);
  console.log("");
  console.log(
    `[${new Date().toISOString().slice(11, 19)}] liveSummary walletUsdc=${fmtUsd(
      walletUsdcBalanceUsd,
    )} openOrders=${open.length} rewardEligible=${rewardEligible} exposure=${fmtUsd(
      exposure,
    )} realisedPnl=${fmtUsd(state.realisedPnl)} unrealisedPnl=${fmtUsd(state.unrealisedPnl)} tradingPnl=${fmtUsd(
      state.totalPnl,
    )} estRewards=${fmtUsd(state.estimatedRewardsUsd)} livePlaced=${state.strategyStats.liveOrdersPlaced} liveCancelled=${
      state.strategyStats.liveOrdersCancelled
    }`,
  );
}

export function printPaperReport(state: AlphaBotState): void {
  console.log("NUCKELAVEE ALPHA PAPER REPORT");
  console.log("");
  console.log(`Starting balance: $${state.startingBalance.toFixed(2)}`);
  console.log(`Cash: $${state.cash.toFixed(2)}`);
  console.log(`Realised P&L: ${fmtUsd(state.realisedPnl)}`);
  console.log(`Unrealised P&L: ${fmtUsd(state.unrealisedPnl)}`);
  console.log(`Estimated LP rewards: ${fmtUsd(state.estimatedRewardsUsd)}`);
  console.log(`Total trading P&L: ${fmtUsd(state.totalPnl)}`);
  console.log(`Total estimated result: ${fmtUsd(state.totalPnl + state.estimatedRewardsUsd)}`);
  console.log("");
  console.log(`Open orders: ${state.openOrders.filter((order) => order.status === "open").length}`);
  console.log(`Fills: ${state.fills.length}`);
  console.log(`Cancelled/expired orders: ${state.cancelledOrders.length}`);
  console.log(`Reward-eligible time: ${(state.rewardEligibleSeconds / 3600).toFixed(2)}h`);
}
