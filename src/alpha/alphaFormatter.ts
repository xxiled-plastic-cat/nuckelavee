import type { AlphaConfig } from "./alphaConfig.js";
import type { AlphaBotState, AlphaMarket, AlphaOpportunity, AlphaOrderbook, AlphaParityPlan } from "./alphaTypes.js";
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

function spreadRows(scan: AlphaScanResult): Array<{ title: string; outcome: "YES" | "NO"; bid: number; ask: number; spread: number; midpoint: number }> {
  const marketByAppId = new Map([...scan.markets, ...scan.rewardMarkets].map((market) => [market.marketAppId, market]));
  const rows: Array<{ title: string; outcome: "YES" | "NO"; bid: number; ask: number; spread: number; midpoint: number }> = [];
  for (const book of scan.orderbooks.values()) {
    const market = marketByAppId.get(book.marketAppId);
    if (!market) continue;
    if (book.yesBid !== undefined && book.yesAsk !== undefined && book.yesMid !== undefined && book.yesSpread !== undefined) {
      rows.push({ title: market.title, outcome: "YES", bid: book.yesBid, ask: book.yesAsk, spread: book.yesSpread, midpoint: book.yesMid });
    }
    if (book.noBid !== undefined && book.noAsk !== undefined && book.noMid !== undefined && book.noSpread !== undefined) {
      rows.push({ title: market.title, outcome: "NO", bid: book.noBid, ask: book.noAsk, spread: book.noSpread, midpoint: book.noMid });
    }
  }
  return rows.sort((a, b) => b.spread - a.spread);
}

function fmtVolume(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "unknown";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function uniqueMarketsByVolume(scan: AlphaScanResult): AlphaMarket[] {
  const markets = new Map<number, AlphaMarket>();
  for (const market of [...scan.markets, ...scan.rewardMarkets]) {
    const previous = markets.get(market.marketAppId);
    markets.set(market.marketAppId, {
      ...market,
      reward: market.reward.isRewardMarket ? market.reward : (previous?.reward ?? market.reward),
      volume: market.volume ?? previous?.volume,
    });
  }
  return [...markets.values()].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
}

function bestDepthUsd(levels: Array<{ price: number; quantityShares: number }>): number {
  const [level] = levels;
  return level ? level.price * level.quantityShares : 0;
}

function outcomeDepthUsd(book: AlphaOrderbook, outcome: "YES" | "NO"): number {
  const orders = outcome === "YES" ? book.yesSideOrders : book.noSideOrders;
  return Math.min(bestDepthUsd(orders.bids), bestDepthUsd(orders.asks));
}

function bestSpreadMatch(
  market: AlphaMarket,
  book: AlphaOrderbook | undefined,
  config: AlphaConfig,
): { label: string; reason: string } {
  if (!config.enableSpreadCapture) return { label: "off", reason: "disabled" };
  if (!book || book.source === "unavailable") return { label: "no", reason: "book unavailable/not scanned" };
  if ((market.volume ?? 0) < config.minSpreadVolumeUsd) return { label: "no", reason: `volume < $${config.minSpreadVolumeUsd.toFixed(2)}` };
  const candidates = [
    { outcome: "YES", bid: book.yesBid, ask: book.yesAsk, mid: book.yesMid, spread: book.yesSpread, depthUsd: outcomeDepthUsd(book, "YES") },
    { outcome: "NO", bid: book.noBid, ask: book.noAsk, mid: book.noMid, spread: book.noSpread, depthUsd: outcomeDepthUsd(book, "NO") },
  ] as const;
  const matches = candidates
    .filter(
      (candidate) =>
        candidate.bid !== undefined &&
        candidate.ask !== undefined &&
        candidate.mid !== undefined &&
        candidate.spread !== undefined &&
        candidate.spread * 100 >= config.minSpreadCaptureCents &&
        candidate.depthUsd >= config.minSpreadDepthUsd &&
        candidate.mid >= config.minSpreadEntryMidpoint &&
        candidate.mid <= config.maxSpreadMidpoint,
    )
    .sort((a, b) => (b.spread ?? 0) - (a.spread ?? 0));
  const best = matches[0];
  if (best) return { label: "watch", reason: `${best.outcome} ${fmtCents(best.spread)} @ mid ${fmtPrice(best.mid)}, depth $${best.depthUsd.toFixed(2)}; needs ${config.spreadPersistenceScans} live scans` };
  const twoSided = candidates.find((candidate) => candidate.bid !== undefined && candidate.ask !== undefined && candidate.mid !== undefined);
  if (!twoSided) return { label: "no", reason: "no two-sided outcome" };
  if ((twoSided.spread ?? 0) * 100 < config.minSpreadCaptureCents) return { label: "no", reason: `spread < ${config.minSpreadCaptureCents.toFixed(2)}c` };
  if (twoSided.depthUsd < config.minSpreadDepthUsd) return { label: "no", reason: `depth < $${config.minSpreadDepthUsd.toFixed(2)}` };
  return { label: "no", reason: `mid outside ${fmtPrice(config.minSpreadEntryMidpoint)}-${fmtPrice(config.maxSpreadMidpoint)}` };
}

function rewardMatch(
  market: AlphaMarket,
  rewardByMarketAppId: Map<number, AlphaOpportunity>,
): { label: string; reason: string } {
  if (!market.reward.isRewardMarket) return { label: "no", reason: "not reward market" };
  const candidate = rewardByMarketAppId.get(market.marketAppId);
  if (!candidate) return { label: "watch", reason: "reward metadata incomplete" };
  if (candidate.warnings.length === 0) return { label: "good", reason: `daily ${fmtUsd(candidate.reward.estimatedRewardUsdPerDay)}` };
  return { label: "watch", reason: candidate.warnings.join("; ") };
}

export function printScan(scan: AlphaScanResult, rewardCandidates: AlphaOpportunity[], parity: AlphaParityPlan[], config: AlphaConfig): void {
  const surface = summarizeBooks(scan.orderbooks.values());
  const rewardByMarketAppId = new Map(rewardCandidates.map((candidate) => [candidate.marketAppId, candidate]));
  const marketRows = uniqueMarketsByVolume(scan);
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
  console.log("Top spread candidates:");
  for (const row of spreadRows(scan).slice(0, 8)) {
    console.log(
      `- ${row.title} ${row.outcome} bid=${fmtPrice(row.bid)} ask=${fmtPrice(row.ask)} mid=${fmtPrice(row.midpoint)} spread=${fmtCents(row.spread)}`,
    );
  }
  if (spreadRows(scan).length === 0) console.log("- none");
  console.log("");
  console.log("Top parity / merge candidates:");
  for (const plan of parity.slice(0, 8)) {
    console.log(
      `- ${plan.title} ${plan.type} YES=${fmtPrice(plan.yesPrice)} NO=${fmtPrice(plan.noPrice)} size=${plan.sizeShares.toFixed(
        6,
      )} gross=${fmtUsd(plan.expectedGrossPnlUsd)} netEdge=${plan.estimatedNetEdgeBps.toFixed(0)}bps`,
    );
  }
  if (parity.length === 0) console.log("- none");
  console.log("");
  console.log("Markets by volume:");
  for (const market of marketRows) {
    const reward = rewardMatch(market, rewardByMarketAppId);
    const spread = bestSpreadMatch(market, scan.orderbooks.get(market.marketAppId), config);
    console.log(`- ${market.title} volume=${fmtVolume(market.volume)} rewards=${reward.label} (${reward.reason}) spread=${spread.label} (${spread.reason})`);
  }
  if (marketRows.length === 0) console.log("- none");
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
    const minContracts = rewardMarkets.find((market) => market.marketAppId === candidate.marketAppId)?.reward.minContracts;
    console.log(`Min aggregate reward size: ${minContracts?.toFixed(6) ?? "unknown"} contracts`);
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
  console.log(`Min aggregate reward size: ${market.reward.minContracts?.toFixed(6) ?? "unknown"} contracts`);
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

export function printLiveSummary(state: AlphaBotState, walletUsdcBalanceUsd?: number, walletAlgoBalance?: number): void {
  const open = state.openOrders.filter((order) => order.status === "open" && order.runMode === "live");
  const rewardEligible = open.filter((order) => order.rewardEligible).length;
  const exposure = open.reduce((sum, order) => sum + (order.side === "bid" ? order.price * order.remainingShares : 0), 0);
  console.log("");
  console.log(`[${new Date().toISOString().slice(11, 19)}] liveSummary`);
  console.log(`  walletUsdc: ${fmtUsd(walletUsdcBalanceUsd)}`);
  console.log(`  walletAlgo: ${walletAlgoBalance === undefined ? "unknown" : walletAlgoBalance.toFixed(6)}`);
  console.log(`  openOrders: ${open.length}`);
  console.log(`  rewardEligible: ${rewardEligible}`);
  console.log(`  exposure: ${fmtUsd(exposure)}`);
  console.log(`  realisedPnl: ${fmtUsd(state.realisedPnl)}`);
  console.log(`  unrealisedPnl: ${fmtUsd(state.unrealisedPnl)}`);
  console.log(`  tradingPnl: ${fmtUsd(state.totalPnl)}`);
  console.log(`  spreadPnl: ${fmtUsd(state.strategyStats.spreadRealisedPnl)}`);
  console.log(`  spreadFills: ${state.strategyStats.spreadEntryFills}/${state.strategyStats.spreadExitFills}`);
  console.log(`  parityPnl: ${fmtUsd(state.strategyStats.parityGrossPnl)}`);
  console.log(`  parityTrades: ${state.strategyStats.parityTradesExecuted}`);
  console.log(`  parityFailed: ${state.strategyStats.parityFailedLegs}`);
  console.log(`  estRewards: ${fmtUsd(state.estimatedRewardsUsd)}`);
  console.log(`  livePlaced: ${state.strategyStats.liveOrdersPlaced}`);
  console.log(`  liveCancelled: ${state.strategyStats.liveOrdersCancelled}`);
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
