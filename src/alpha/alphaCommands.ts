import dotenv from "dotenv";

import { readAlphaConfig } from "./alphaConfig.js";
import { AlphaSdkClient } from "./alphaClient.js";
import { loadAlphaScan } from "./alphaMarketScanner.js";
import { rankRewardCandidates } from "./alphaRewardScanner.js";
import { scanParity } from "./alphaParityScanner.js";
import { printLiveSummary, printMarketDetail, printPaperReport, printPaperWatch, printRewards, printScan } from "./alphaFormatter.js";
import { runPaperTick, loadPaperReport } from "./paperTrader.js";
import { runLiveTick } from "./liveTrader.js";
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
  const { scan, rewardCandidates, parity } = await buildScan(false);
  printScan(scan, rewardCandidates, parity);
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

async function runLiveCommand(mode: "live-dry-run" | "live"): Promise<void> {
  const { config, scan } = await buildScan(mode === "live");
  const result = await runLiveTick(scan, config, mode);
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
