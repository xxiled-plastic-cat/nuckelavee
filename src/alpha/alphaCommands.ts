import dotenv from "dotenv";
import algosdk from "algosdk";

import { readAlphaConfig } from "./alphaConfig.js";
import { AlphaSdkClient } from "./alphaClient.js";
import { loadAlphaScan } from "./alphaMarketScanner.js";
import { rankRewardCandidates } from "./alphaRewardScanner.js";
import { scanParity } from "./alphaParityScanner.js";
import { saveAlphaState } from "./alphaStateStore.js";
import {
  printLiveSummary,
  printMarketDetail,
  printPaperReport,
  printPaperWatch,
  printRewards,
  printScan,
  summarizeLiveExposure,
} from "./alphaFormatter.js";
import type { AlphaBotState } from "./alphaTypes.js";
import { runPaperTick, loadPaperReport } from "./paperTrader.js";
import type { LiveAction } from "./liveTrader.js";
import { runLiveTick } from "./liveTrader.js";
import { notifyTelegram, notifyTelegramThrottled, readSkipNoticeThrottleMinutes } from "./telegramNotifier.js";
import { closeDatabase } from "../db.js";

dotenv.config();

const DEFAULT_REWARD_HISTORY_RECEIVER = "65GJKPMEYLR2C2GHFIAUKF2CFDE6IXDB3LUTOVJ424LBMMEWJ6UXCHCBZQ";
const DEFAULT_REWARD_HISTORY_SENDER = "LPCTQJDOFBG5J63LOUY6A6JMHHHXIVOIZ7FLN6FETFSSWQOJR56V65INTU";
const MICRO = 1_000_000n;

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

function formatMicroUsdc(value: bigint): string {
  const whole = value / MICRO;
  const fraction = (value % MICRO).toString().padStart(6, "0");
  return `${whole.toString()}.${fraction}`;
}

function parseNextToken(response: Record<string, unknown>): string | undefined {
  const nextToken = response["next-token"];
  if (typeof nextToken === "string" && nextToken.length > 0) return nextToken;
  const next = response.next;
  if (typeof next === "string" && next.length > 0) return next;
  const camel = response.nextToken;
  if (typeof camel === "string" && camel.length > 0) return camel;
  return undefined;
}

function parseBigIntAmount(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.floor(value));
  if (typeof value === "string" && value.length > 0) {
    try {
      return BigInt(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

type ParsedAssetTransfer = {
  sender?: string;
  receiver?: string;
  assetId?: bigint;
  amount?: bigint;
};

function collectAssetTransfers(txn: Record<string, unknown>, inheritedSender?: string): ParsedAssetTransfer[] {
  const transfers: ParsedAssetTransfer[] = [];
  const sender = typeof txn.sender === "string" ? txn.sender : inheritedSender;
  const transfer = txn["assetTransferTransaction"];
  if (transfer && typeof transfer === "object") {
    const payload = transfer as Record<string, unknown>;
    const parsed: ParsedAssetTransfer = {
      sender: typeof payload.sender === "string" ? payload.sender : sender,
      receiver: typeof payload.receiver === "string" ? payload.receiver : undefined,
      assetId: parseBigIntAmount(payload["assetId"] ?? payload.assetId),
      amount: parseBigIntAmount(payload.amount),
    };
    transfers.push(parsed);
  }
  const inner = txn["innerTxns"];
  if (Array.isArray(inner)) {
    for (const child of inner) {
      if (child && typeof child === "object") {
        transfers.push(...collectAssetTransfers(child as Record<string, unknown>, sender));
      }
    }
  }
  return transfers;
}

async function runRewardHistoryCommand(receiverArg: string | undefined, senderArg: string | undefined): Promise<void> {
  const config = readAlphaConfig();
  const receiver = (receiverArg || process.env.ALPHA_REWARD_HISTORY_RECEIVER || DEFAULT_REWARD_HISTORY_RECEIVER).trim();
  const sender = (senderArg || process.env.ALPHA_REWARD_HISTORY_SENDER || DEFAULT_REWARD_HISTORY_SENDER).trim();
  if (!algosdk.isValidAddress(receiver)) {
    throw new Error(`Invalid Algorand receiver address for rewards history: ${receiver}`);
  }
  if (!algosdk.isValidAddress(sender)) {
    throw new Error(`Invalid Algorand sender address for rewards history: ${sender}`);
  }

  const indexer = new algosdk.Indexer(config.algodToken ?? "", config.indexerServer, "");
  let nextToken: string | undefined;
  let pageCount = 0;
  let transactionCount = 0;
  let incomingTransferCount = 0;
  let incomingTotalMicroUsdc = 0n;
  let rewardTransferCount = 0;
  let rewardTotalMicroUsdc = 0n;
  let pageLimit = 200;

  while (true) {
    let response: Record<string, unknown> | undefined;
    let attempts = 0;
    while (!response) {
      attempts += 1;
      try {
        let query = indexer.searchForTransactions().address(receiver).limit(pageLimit);
        if (nextToken) {
          query = query.nextToken(nextToken);
        }
        response = (await query.do()) as unknown as Record<string, unknown>;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const timedOut = message.toLowerCase().includes("statement timeout");
        if (!timedOut || attempts >= 4) {
          throw new Error(
            `Reward history scan failed on page ${pageCount + 1} (next=${nextToken ?? "none"}, limit=${pageLimit}): ${message}`,
          );
        }
        pageLimit = Math.max(25, Math.floor(pageLimit / 2));
        await new Promise((resolve) => setTimeout(resolve, 500 * attempts));
      }
    }
    const transactions = Array.isArray(response.transactions) ? response.transactions : [];
    pageCount += 1;
    transactionCount += transactions.length;

    for (const transaction of transactions as Array<Record<string, unknown>>) {
      const transfers = collectAssetTransfers(transaction);
      for (const transfer of transfers) {
        if (transfer.receiver !== receiver) continue;
        if (transfer.assetId !== BigInt(config.usdcAssetId)) continue;
        if (transfer.amount === undefined) continue;
        const amount = transfer.amount;
        incomingTotalMicroUsdc += amount;
        incomingTransferCount += 1;
        if (transfer.sender === sender) {
          rewardTotalMicroUsdc += amount;
          rewardTransferCount += 1;
        }
      }
    }

    const parsedNext = parseNextToken(response);
    if (!parsedNext || parsedNext === nextToken || transactions.length === 0) break;
    nextToken = parsedNext;
  }

  console.log("NUCKELAVEE ALPHA REWARD HISTORY");
  console.log("");
  console.log(`Receiver: ${receiver}`);
  console.log(`Reward sender filter: ${sender}`);
  console.log(`USDC asset ID: ${config.usdcAssetId}`);
  console.log(`Pages scanned: ${pageCount}`);
  console.log(`Transactions gathered before filtering: ${transactionCount}`);
  console.log(`Incoming USDC transfers (all senders): ${incomingTransferCount}`);
  console.log(`Incoming USDC total (all senders): ${formatMicroUsdc(incomingTotalMicroUsdc)}`);
  console.log(`Reward transfers (filtered sender): ${rewardTransferCount}`);
  console.log(`Total rewards received: ${formatMicroUsdc(rewardTotalMicroUsdc)}`);
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
  config: ReturnType<typeof readAlphaConfig>;
}): string {
  const actionSummary = summarizeTickActions(result.actions);
  const exposure = summarizeLiveExposure(result.state, result.config);
  const tickAt = new Date().toISOString();

  return [
    `Tick digest ${tickAt}`,
    `placed=${actionSummary.placed.length} cancelled=${actionSummary.cancelled.length} inferred_entry_fills=${actionSummary.inferredEntryFills.length} inferred_exit_fills=${actionSummary.inferredExitFills.length}`,
    `wallet_usdc=${formatUsd(result.walletUsdcBalanceUsd)}`,
    `wallet_algo=${result.walletAlgoBalance === undefined ? "unknown" : result.walletAlgoBalance.toFixed(6)}`,
    `open_orders=${exposure.openOrders} bid_orders=${exposure.bidOrders} exit_orders=${exposure.exitOrders}`,
    `bid_exposure=${formatUsd(exposure.bidExposureUsd)} reward_bid_exposure=${formatUsd(exposure.rewardBidExposureUsd)} reward_eligible_bid_exposure=${formatUsd(
      exposure.rewardEligibleBidExposureUsd,
    )} spread_bid_exposure=${formatUsd(exposure.spreadBidExposureUsd)}`,
    `exit_notional=${formatUsd(exposure.exitNotionalUsd)} reward_eligible_exit_notional=${formatUsd(
      exposure.rewardEligibleExitNotionalUsd,
    )} exits_not_counted_as_exposure=true`,
    `exit_pnl_if_filled=${formatUsd(exposure.exitPnlIfFilledUsd)} realised_plus_open_exit_pnl=${formatUsd(exposure.realisedPlusOpenExitPnlUsd)}`,
    `realised_pnl=${formatUsd(result.state.realisedPnl)} unrealised_pnl=${formatUsd(result.state.unrealisedPnl)} trading_pnl=${formatUsd(result.state.totalPnl)}`,
    `active_reward_rate=${formatRewardUsd(exposure.activeRewardRateDailyUsd)}/day potential_reward_rate=${formatRewardUsd(
      exposure.potentialRewardRateDailyUsd,
    )}/day est_rewards_accrued=${formatRewardUsd(result.state.estimatedRewardsUsd)}`,
    `spread_pnl=${formatUsd(result.state.strategyStats.spreadRealisedPnl)} parity_pnl=${formatUsd(result.state.strategyStats.parityGrossPnl)}`,
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

function formatRewardUsd(value: number | undefined): string {
  if (value === undefined) return "unknown";
  const decimals = Math.abs(value) < 0.01 ? 6 : 2;
  return `$${value.toFixed(decimals)}`;
}

function shouldSendDailySummary(state: AlphaBotState): boolean {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (state.notificationState?.lastDailySummaryDate === today) return false;
  const targetHour = readDailySummaryHourUtc();
  if (targetHour === undefined) return true;
  return now.getUTCHours() === targetHour;
}

function buildDailySummaryMessage(
  state: AlphaBotState,
  walletUsdcBalanceUsd?: number,
  walletAlgoBalance?: number,
  config?: ReturnType<typeof readAlphaConfig>,
): string {
  const exposure = summarizeLiveExposure(state, config);
  const date = new Date().toISOString().slice(0, 10);
  return [
    `Daily summary ${date}`,
    `wallet_usdc=${formatUsd(walletUsdcBalanceUsd)}`,
    `wallet_algo=${walletAlgoBalance === undefined ? "unknown" : walletAlgoBalance.toFixed(6)}`,
    `open_orders=${exposure.openOrders}`,
    `bid_orders=${exposure.bidOrders}`,
    `exit_orders=${exposure.exitOrders}`,
    `bid_exposure=${formatUsd(exposure.bidExposureUsd)}`,
    `reward_bid_exposure=${formatUsd(exposure.rewardBidExposureUsd)}`,
    `reward_eligible_bid_exposure=${formatUsd(exposure.rewardEligibleBidExposureUsd)}`,
    `spread_bid_exposure=${formatUsd(exposure.spreadBidExposureUsd)}`,
    `exit_notional=${formatUsd(exposure.exitNotionalUsd)}`,
    `reward_eligible_exit_notional=${formatUsd(exposure.rewardEligibleExitNotionalUsd)}`,
    `exits_not_counted_as_exposure=true`,
    `exit_pnl_if_filled=${formatUsd(exposure.exitPnlIfFilledUsd)}`,
    `realised_plus_open_exit_pnl=${formatUsd(exposure.realisedPlusOpenExitPnlUsd)}`,
    `trading_pnl=${formatUsd(state.totalPnl)}`,
    `active_reward_rate=${formatRewardUsd(exposure.activeRewardRateDailyUsd)}/day`,
    `potential_reward_rate=${formatRewardUsd(exposure.potentialRewardRateDailyUsd)}/day`,
    `spread_pnl=${formatUsd(state.strategyStats.spreadRealisedPnl)}`,
    `parity_pnl=${formatUsd(state.strategyStats.parityGrossPnl)}`,
    `est_rewards_accrued=${formatRewardUsd(state.estimatedRewardsUsd)}`,
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
    const digest = buildTickDigestMessage({ ...result, config });
    await notifyTelegram(digest);
  }
  if (mode === "live" && shouldSendDailySummary(result.state)) {
    const dailySummary = buildDailySummaryMessage(result.state, result.walletUsdcBalanceUsd, result.walletAlgoBalance, config);
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
  printLiveSummary(result.state, result.walletUsdcBalanceUsd, result.walletAlgoBalance, config);
}

function printUsage(): void {
  console.log(
    "Usage: tsx src/alpha/alphaCommands.ts <scan|rewards|reward-history|watch|market|paper|paper-watch|paper-report|live-dry-run|live>",
  );
  console.log("  reward-history args: [receiverAddress] [rewardSenderAddress]");
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "scan") return runScanCommand();
  if (command === "rewards") return runRewardsCommand();
  if (command === "reward-history") return runRewardHistoryCommand(process.argv[3], process.argv[4]);
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
