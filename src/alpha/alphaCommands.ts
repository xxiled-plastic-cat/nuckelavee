import dotenv from "dotenv";

import { readAlphaConfig } from "./alphaConfig.js";
import { AlphaSdkClient } from "./alphaClient.js";
import { loadAlphaScan } from "./alphaMarketScanner.js";
import { rankRewardCandidates } from "./alphaRewardScanner.js";
import { scanParity } from "./alphaParityScanner.js";
import { saveAlphaState } from "./alphaStateStore.js";
import { printLiveSummary, printMarketDetail, printPaperReport, printPaperWatch, printRewards, printScan } from "./alphaFormatter.js";
import type { AlphaBotState } from "./alphaTypes.js";
import { runPaperTick, loadPaperReport } from "./paperTrader.js";
import type { LiveAction } from "./liveTrader.js";
import { runLiveTick } from "./liveTrader.js";
import { notifyTelegram, notifyTelegramThrottled, readSkipNoticeThrottleMinutes } from "./telegramNotifier.js";
import { closeDatabase } from "../db.js";

dotenv.config();

async function buildScan(liveSigner = false) {
  const config = readAlphaConfig();
  const client = new AlphaSdkClient(config, liveSigner);
  const scan = await loadAlphaScan(client, config);
  const uniqueMarkets = new Map([...scan.rewardMarkets, ...scan.markets].map((market) => [market.marketAppId, market]));
  const allMarkets = [...uniqueMarkets.values()];
  const rewardCandidates = rankRewardCandidates(allMarkets, scan.orderbooks, config);
  const parity = scanParity(allMarkets, scan.orderbooks, config);
  return { config, client, scan, rewardCandidates, parity };
}

async function runScanCommand(): Promise<void> {
  const { config, scan, rewardCandidates, parity } = await buildScan(false);
  printScan(scan, rewardCandidates, parity, config);
}

async function runRewardsCommand(): Promise<void> {
  const { scan, rewardCandidates } = await buildScan(false);
  printRewards(scan.rewardMarkets, rewardCandidates, scan.rewardError);
}

async function runMarketCommand(arg: string | undefined): Promise<void> {
  if (!arg) throw new Error("Usage: npm run alpha:market -- <slug-or-id>");
  const { client } = await buildScan(false);
  const market = await client.getMarket(arg);
  if (!market) throw new Error(`Alpha market not found: ${arg}`);
  const book = await client.getOrderbook(market);
  printMarketDetail(market, book);
}

async function runPaperCommand(): Promise<void> {
  const { config, scan } = await buildScan(false);
  const state = await runPaperTick(scan, config);
  printPaperWatch(state);
}

async function runPaperWatchCommand(): Promise<void> {
  const config = readAlphaConfig();
  const loop = async () => {
    try {
      const { scan } = await buildScan(false);
      const state = await runPaperTick(scan, config);
      printPaperWatch(state);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${new Date().toISOString().slice(11, 19)}] alpha_paper_failed: ${message}`);
    }
  };
  await loop();
  setInterval(loop, config.scanIntervalMs);
}

async function runPaperReportCommand(): Promise<void> {
  const config = readAlphaConfig();
  const state = await loadPaperReport(config);
  printPaperReport(state);
}

function isLowBalanceWarning(message: string): boolean {
  return (
    message.includes("below safety floor") ||
    message.includes("below parity cost") ||
    message.includes("below split amount") ||
    message.includes("No live placements; wallet ALGO")
  );
}

function summarizeTickActions(actions: LiveAction[]): {
  placed: string[];
  cancelled: string[];
  inferredEntryFills: string[];
  inferredExitFills: string[];
  parityEvents: string[];
  warnings: string[];
} {
  const summary = {
    placed: [] as string[],
    cancelled: [] as string[],
    inferredEntryFills: [] as string[],
    inferredExitFills: [] as string[],
    parityEvents: [] as string[],
    warnings: [] as string[],
  };

  for (const action of actions) {
    if (action.kind === "place") {
      summary.placed.push(action.message);
      continue;
    }
    if (action.kind === "cancel") {
      summary.cancelled.push(action.message);
      continue;
    }
    if (action.message.startsWith("Inferred live entry fill")) {
      summary.inferredEntryFills.push(action.message);
      continue;
    }
    if (action.message.startsWith("Inferred live exit fill")) {
      summary.inferredExitFills.push(action.message);
      continue;
    }
    if (action.kind === "parity" || action.message.startsWith("Parity failed")) {
      summary.parityEvents.push(action.message);
      continue;
    }
    if (isLowBalanceWarning(action.message)) {
      summary.warnings.push(action.message);
    }
  }
  return summary;
}

function compactLines(lines: string[], maxItems = 2): string {
  if (lines.length === 0) return "none";
  const shown = lines.slice(0, maxItems).join(" | ");
  return lines.length > maxItems ? `${shown} | +${lines.length - maxItems} more` : shown;
}

function buildTickDigestMessage(result: {
  actions: LiveAction[];
  state: AlphaBotState;
  walletUsdcBalanceUsd?: number;
  walletAlgoBalance?: number;
}): string {
  const actionSummary = summarizeTickActions(result.actions);
  const open = result.state.openOrders.filter((order) => order.status === "open" && order.runMode === "live");
  const rewardEligible = open.filter((order) => order.rewardEligible).length;
  const exposure = open.reduce((sum, order) => sum + (order.side === "bid" ? order.price * order.remainingShares : 0), 0);
  const tickAt = new Date().toISOString();

  return [
    `Tick digest ${tickAt}`,
    `placed=${actionSummary.placed.length} cancelled=${actionSummary.cancelled.length} inferred_entry_fills=${actionSummary.inferredEntryFills.length} inferred_exit_fills=${actionSummary.inferredExitFills.length}`,
    `wallet_usdc=${formatUsd(result.walletUsdcBalanceUsd)}`,
    `wallet_algo=${result.walletAlgoBalance === undefined ? "unknown" : result.walletAlgoBalance.toFixed(6)}`,
    `open_orders=${open.length} reward_eligible=${rewardEligible} exposure=${formatUsd(exposure)}`,
    `realised_pnl=${formatUsd(result.state.realisedPnl)} unrealised_pnl=${formatUsd(result.state.unrealisedPnl)} trading_pnl=${formatUsd(result.state.totalPnl)}`,
    `spread_pnl=${formatUsd(result.state.strategyStats.spreadRealisedPnl)} parity_pnl=${formatUsd(result.state.strategyStats.parityGrossPnl)} est_rewards=${formatUsd(result.state.estimatedRewardsUsd)}`,
    `placed_orders=${compactLines(actionSummary.placed)}`,
    `closed_or_cancelled=${compactLines([...actionSummary.cancelled, ...actionSummary.inferredExitFills])}`,
    `warnings=${compactLines(actionSummary.warnings, 1)}`,
  ].join("\n");
}

function extractTickAbortMessages(actions: LiveAction[]): string[] {
  return actions
    .filter((action) => action.message.startsWith("Tick aborted safely:"))
    .map((action) => action.message.replace("Tick aborted safely:", "").trim());
}

function readDailySummaryHourUtc(): number | undefined {
  const raw = process.env.ALPHA_TELEGRAM_DAILY_SUMMARY_HOUR?.trim();
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23) return undefined;
  return parsed;
}

function formatUsd(value: number | undefined): string {
  if (value === undefined) return "unknown";
  return `$${value.toFixed(2)}`;
}

function shouldSendDailySummary(state: AlphaBotState): boolean {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (state.notificationState?.lastDailySummaryDate === today) return false;
  const targetHour = readDailySummaryHourUtc();
  if (targetHour === undefined) return true;
  return now.getUTCHours() === targetHour;
}

function buildDailySummaryMessage(state: AlphaBotState, walletUsdcBalanceUsd?: number, walletAlgoBalance?: number): string {
  const open = state.openOrders.filter((order) => order.status === "open" && order.runMode === "live");
  const rewardEligible = open.filter((order) => order.rewardEligible).length;
  const exposure = open.reduce((sum, order) => sum + (order.side === "bid" ? order.price * order.remainingShares : 0), 0);
  const date = new Date().toISOString().slice(0, 10);
  return [
    `Daily summary ${date}`,
    `wallet_usdc=${formatUsd(walletUsdcBalanceUsd)}`,
    `wallet_algo=${walletAlgoBalance === undefined ? "unknown" : walletAlgoBalance.toFixed(6)}`,
    `open_orders=${open.length}`,
    `reward_eligible=${rewardEligible}`,
    `exposure=${formatUsd(exposure)}`,
    `trading_pnl=${formatUsd(state.totalPnl)}`,
    `spread_pnl=${formatUsd(state.strategyStats.spreadRealisedPnl)}`,
    `parity_pnl=${formatUsd(state.strategyStats.parityGrossPnl)}`,
    `est_rewards=${formatUsd(state.estimatedRewardsUsd)}`,
    `live_placed=${state.strategyStats.liveOrdersPlaced}`,
    `live_cancelled=${state.strategyStats.liveOrdersCancelled}`,
  ].join("\n");
}

async function runLiveCommand(mode: "live-dry-run" | "live"): Promise<void> {
  const { config, scan } = await buildScan(mode === "live");
  const result = await runLiveTick(scan, config, mode);
  const abortMessages = extractTickAbortMessages(result.actions);
  if (mode === "live" && abortMessages.length > 0) {
    const throttleMinutes = readSkipNoticeThrottleMinutes();
    const summary = abortMessages.slice(0, 2).join(" | ");
    await notifyTelegramThrottled(
      "alpha-live-tick-aborted",
      `ALERT: Nuckelavee live tick aborted safely\nreasons=${summary}\nwallet_usdc=${formatUsd(result.walletUsdcBalanceUsd)}\nwallet_algo=${
        result.walletAlgoBalance === undefined ? "unknown" : result.walletAlgoBalance.toFixed(6)
      }`,
      { throttleMinutes },
    );
  }
  if (mode === "live") {
    const digest = buildTickDigestMessage(result);
    await notifyTelegram(digest);
  }
  if (mode === "live" && shouldSendDailySummary(result.state)) {
    const dailySummary = buildDailySummaryMessage(result.state, result.walletUsdcBalanceUsd, result.walletAlgoBalance);
    const sent = await notifyTelegram(dailySummary);
    if (sent) {
      result.state.notificationState ??= {};
      result.state.notificationState.lastDailySummaryDate = new Date().toISOString().slice(0, 10);
      await saveAlphaState(config.stateKey, result.state);
    }
  }
  console.log(mode === "live" ? "NUCKELAVEE ALPHA LIVE" : "NUCKELAVEE ALPHA LIVE DRY RUN");
  console.log("");
  for (const action of result.actions) {
    console.log(`[${action.kind.toUpperCase()}] ${action.message}`);
  }
  if (result.actions.length === 0) console.log("No actions.");
  printLiveSummary(result.state, result.walletUsdcBalanceUsd, result.walletAlgoBalance);
}

function printUsage(): void {
  console.log("Usage: tsx src/alpha/alphaCommands.ts <scan|rewards|watch|market|paper|paper-watch|paper-report|live-dry-run|live>");
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "scan") return runScanCommand();
  if (command === "rewards") return runRewardsCommand();
  if (command === "watch") return runPaperWatchCommand();
  if (command === "market") return runMarketCommand(process.argv[3]);
  if (command === "paper") return runPaperCommand();
  if (command === "paper-watch") return runPaperWatchCommand();
  if (command === "paper-report") return runPaperReportCommand();
  if (command === "live-dry-run") return runLiveCommand("live-dry-run");
  if (command === "live") return runLiveCommand("live");
  printUsage();
  process.exitCode = 1;
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}).finally(async () => {
  if (process.argv[2] !== "watch" && process.argv[2] !== "paper-watch") {
    await closeDatabase();
  }
});
