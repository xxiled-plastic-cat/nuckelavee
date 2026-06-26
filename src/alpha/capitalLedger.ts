import algosdk from "algosdk";

import type { AlphaConfig } from "./alphaConfig.js";
import { microUsdcToUsd, scanWalletUsdcTransfers, type WalletUsdcTransfer } from "./indexerTransfers.js";
import type { AlphaBotState } from "./alphaTypes.js";

export const ALPHA_INITIAL_CAPITAL_USD = 206;
export const ALPHA_REWARD_HISTORY_SENDER = "LPCTQJDOFBG5J63LOUY6A6JMHHHXIVOIZ7FLN6FETFSSWQOJR56V65INTU";
const CAPITAL_LEDGER_CACHE_MS = 3_600_000;

export type TransferBucket = "reward" | "market" | "external";

export type TransferClassificationContext = {
  walletAddress: string;
  rewardSenderAddress: string;
  matcherAppAddress: string;
  marketAppAddresses: Set<string>;
  escrowAppAddresses: Set<string>;
};

export type FlowTotals = {
  rewardsReceivedUsd: number;
  marketUsdcInUsd: number;
  marketUsdcOutUsd: number;
  externalInUsd: number;
  externalOutUsd: number;
};

export type CapitalLedger = {
  asOf: string;
  contributedCapitalUsd: number;
  netWorthUsd?: number;
  realPnlUsd?: number;
  components: {
    walletUsdc?: number;
    bidEscrowUsd: number;
    positionsValueUsd: number;
  };
  flows: FlowTotals;
  reconciliation: {
    tradingPnlUsd: number;
    estimatedRewardsUsd: number;
    impliedNonTradingUsd?: number;
    externalCapitalDriftUsd: number;
  };
  scanMeta: {
    pagesScanned: number;
    transfersScanned: number;
    cachedAt?: string;
  };
  flowsRefreshed: boolean;
};

type PositionValueInput = {
  valueUsd?: number;
  lockedUsd?: number;
};

type CachedFlowEntry = {
  fetchedAtMs: number;
  flows: FlowTotals;
  scanMeta: { pagesScanned: number; transfersScanned: number };
};

const flowCacheByWallet = new Map<string, CachedFlowEntry>();

export function buildTransferClassificationContext(input: {
  walletAddress: string;
  matcherAppId: number;
  marketAppIds: number[];
  escrowAppIds: number[];
}): TransferClassificationContext {
  const marketAppAddresses = new Set(input.marketAppIds.map((appId) => algosdk.getApplicationAddress(appId).toString()));
  const escrowAppAddresses = new Set(input.escrowAppIds.map((appId) => algosdk.getApplicationAddress(appId).toString()));
  return {
    walletAddress: input.walletAddress,
    rewardSenderAddress: ALPHA_REWARD_HISTORY_SENDER,
    matcherAppAddress: algosdk.getApplicationAddress(input.matcherAppId).toString(),
    marketAppAddresses,
    escrowAppAddresses,
  };
}

function isMarketAddress(address: string, context: TransferClassificationContext): boolean {
  if (address === context.matcherAppAddress) return true;
  if (context.marketAppAddresses.has(address)) return true;
  if (context.escrowAppAddresses.has(address)) return true;
  return false;
}

export function classifyTransfer(
  transfer: WalletUsdcTransfer,
  context: TransferClassificationContext,
): TransferBucket {
  if (transfer.direction === "in") {
    if (transfer.sender === context.rewardSenderAddress) return "reward";
    if (isMarketAddress(transfer.sender, context)) return "market";
    return "external";
  }
  if (isMarketAddress(transfer.receiver, context)) return "market";
  return "external";
}

export function aggregateFlowTotals(
  transfers: WalletUsdcTransfer[],
  context: TransferClassificationContext,
): FlowTotals {
  const totals: FlowTotals = {
    rewardsReceivedUsd: 0,
    marketUsdcInUsd: 0,
    marketUsdcOutUsd: 0,
    externalInUsd: 0,
    externalOutUsd: 0,
  };

  for (const transfer of transfers) {
    const amountUsd = microUsdcToUsd(transfer.amountMicroUsdc);
    const bucket = classifyTransfer(transfer, context);
    if (bucket === "reward") {
      totals.rewardsReceivedUsd += amountUsd;
    } else if (bucket === "market") {
      if (transfer.direction === "in") totals.marketUsdcInUsd += amountUsd;
      else totals.marketUsdcOutUsd += amountUsd;
    } else if (transfer.direction === "in") {
      totals.externalInUsd += amountUsd;
    } else {
      totals.externalOutUsd += amountUsd;
    }
  }

  return totals;
}

export function totalPositionsValueUsd(positions: PositionValueInput[]): number {
  return positions.reduce((sum, position) => {
    if (position.valueUsd !== undefined && Number.isFinite(position.valueUsd)) return sum + position.valueUsd;
    if (position.lockedUsd !== undefined && Number.isFinite(position.lockedUsd)) return sum + position.lockedUsd;
    return sum;
  }, 0);
}

export function computeNetWorth(
  walletUsdc: number | undefined,
  bidEscrowUsd: number,
  positions: PositionValueInput[],
): number | undefined {
  if (walletUsdc === undefined || !Number.isFinite(walletUsdc)) return undefined;
  return walletUsdc + bidEscrowUsd + totalPositionsValueUsd(positions);
}

function flowTotalsFromState(state: AlphaBotState | undefined): FlowTotals | undefined {
  const ledger = state?.capitalLedger;
  if (!ledger) return undefined;
  return {
    rewardsReceivedUsd: ledger.rewardsReceivedUsd,
    marketUsdcInUsd: ledger.marketUsdcInUsd,
    marketUsdcOutUsd: ledger.marketUsdcOutUsd,
    externalInUsd: ledger.externalInUsd,
    externalOutUsd: ledger.externalOutUsd,
  };
}

function scanMetaFromState(state: AlphaBotState | undefined): { pagesScanned: number; transfersScanned: number; cachedAt?: string } {
  const ledger = state?.capitalLedger;
  return {
    pagesScanned: ledger?.pagesScanned ?? 0,
    transfersScanned: ledger?.transfersScanned ?? 0,
    cachedAt: ledger?.lastScanAt,
  };
}

async function refreshFlowTotals(
  walletAddress: string,
  config: AlphaConfig,
  classificationContext: TransferClassificationContext,
): Promise<{ flows: FlowTotals; scanMeta: { pagesScanned: number; transfersScanned: number } }> {
  const scan = await scanWalletUsdcTransfers(walletAddress, config);
  const flows = aggregateFlowTotals(scan.transfers, classificationContext);
  const scanMeta = {
    pagesScanned: scan.pagesScanned,
    transfersScanned: scan.transfers.length,
  };
  flowCacheByWallet.set(walletAddress, {
    fetchedAtMs: Date.now(),
    flows,
    scanMeta,
  });
  return { flows, scanMeta };
}

export function capitalLedgerSnapshotFromState(state: AlphaBotState): AlphaBotState["capitalLedger"] | undefined {
  const cached = state.capitalLedger;
  if (!cached) return undefined;
  return { ...cached };
}

export function mergeCapitalLedgerIntoState(
  state: AlphaBotState,
  flows: FlowTotals,
  scanMeta: { pagesScanned: number; transfersScanned: number },
): AlphaBotState {
  return {
    ...state,
    capitalLedger: {
      lastScanAt: new Date().toISOString(),
      rewardsReceivedUsd: flows.rewardsReceivedUsd,
      marketUsdcInUsd: flows.marketUsdcInUsd,
      marketUsdcOutUsd: flows.marketUsdcOutUsd,
      externalInUsd: flows.externalInUsd,
      externalOutUsd: flows.externalOutUsd,
      pagesScanned: scanMeta.pagesScanned,
      transfersScanned: scanMeta.transfersScanned,
    },
  };
}

export async function buildCapitalLedger(input: {
  config: AlphaConfig;
  walletAddress?: string;
  walletUsdc?: number;
  bidEscrowUsd: number;
  positions: PositionValueInput[];
  state: AlphaBotState;
  marketAppIds: number[];
  escrowAppIds: number[];
  forceRefresh?: boolean;
}): Promise<CapitalLedger> {
  const contributedCapitalUsd = ALPHA_INITIAL_CAPITAL_USD;
  const positionsValueUsd = totalPositionsValueUsd(input.positions);
  const netWorthUsd = computeNetWorth(input.walletUsdc, input.bidEscrowUsd, input.positions);
  const realPnlUsd = netWorthUsd === undefined ? undefined : netWorthUsd - contributedCapitalUsd;

  let flows: FlowTotals = flowTotalsFromState(input.state) ?? {
    rewardsReceivedUsd: 0,
    marketUsdcInUsd: 0,
    marketUsdcOutUsd: 0,
    externalInUsd: 0,
    externalOutUsd: 0,
  };
  let scanMeta = scanMetaFromState(input.state);
  let flowsRefreshed = false;

  if (input.walletAddress && algosdk.isValidAddress(input.walletAddress)) {
    const cacheKey = input.walletAddress;
    const cached = flowCacheByWallet.get(cacheKey);
    const cacheStale =
      input.forceRefresh ||
      !cached ||
      Date.now() - cached.fetchedAtMs >= CAPITAL_LEDGER_CACHE_MS;

    if (cacheStale) {
      try {
        const classificationContext = buildTransferClassificationContext({
          walletAddress: input.walletAddress,
          matcherAppId: input.config.matcherAppId,
          marketAppIds: input.marketAppIds,
          escrowAppIds: input.escrowAppIds,
        });
        const refreshed = await refreshFlowTotals(input.walletAddress, input.config, classificationContext);
        flows = refreshed.flows;
        scanMeta = { ...refreshed.scanMeta, cachedAt: new Date().toISOString() };
        flowsRefreshed = true;
      } catch {
        if (cached) {
          flows = cached.flows;
          scanMeta = { ...cached.scanMeta, cachedAt: scanMeta.cachedAt };
        }
      }
    } else {
      flows = cached.flows;
      scanMeta = { ...cached.scanMeta, cachedAt: new Date(cached.fetchedAtMs).toISOString() };
    }
  }

  const externalCapitalDriftUsd = flows.externalInUsd - flows.externalOutUsd - contributedCapitalUsd;
  const impliedNonTradingUsd = realPnlUsd === undefined ? undefined : realPnlUsd - input.state.totalPnl;

  return {
    asOf: new Date().toISOString(),
    contributedCapitalUsd,
    netWorthUsd,
    realPnlUsd,
    components: {
      walletUsdc: input.walletUsdc,
      bidEscrowUsd: input.bidEscrowUsd,
      positionsValueUsd,
    },
    flows,
    reconciliation: {
      tradingPnlUsd: input.state.totalPnl,
      estimatedRewardsUsd: input.state.estimatedRewardsUsd,
      impliedNonTradingUsd,
      externalCapitalDriftUsd,
    },
    scanMeta: {
      pagesScanned: scanMeta.pagesScanned,
      transfersScanned: scanMeta.transfersScanned,
      cachedAt: scanMeta.cachedAt,
    },
    flowsRefreshed,
  };
}

export function printCapitalLedgerReport(ledger: CapitalLedger, walletAddress?: string): void {
  console.log("NUCKELAVEE ALPHA CAPITAL REPORT");
  console.log("");
  if (walletAddress) console.log(`Wallet: ${walletAddress}`);
  console.log(`As of: ${ledger.asOf}`);
  console.log("");
  console.log("Net worth");
  console.log(`  Contributed capital: $${ledger.contributedCapitalUsd.toFixed(2)}`);
  console.log(`  Wallet USDC: ${ledger.components.walletUsdc === undefined ? "unknown" : `$${ledger.components.walletUsdc.toFixed(2)}`}`);
  console.log(`  Bid escrow USDC: $${ledger.components.bidEscrowUsd.toFixed(2)}`);
  console.log(`  Positions value: $${ledger.components.positionsValueUsd.toFixed(2)}`);
  console.log(`  Net worth: ${ledger.netWorthUsd === undefined ? "unknown" : `$${ledger.netWorthUsd.toFixed(2)}`}`);
  console.log(`  Real PnL: ${ledger.realPnlUsd === undefined ? "unknown" : fmtSignedUsd(ledger.realPnlUsd)}`);
  console.log("");
  console.log("Lifetime USDC flows (indexer)");
  console.log(`  Rewards received: $${ledger.flows.rewardsReceivedUsd.toFixed(6)}`);
  console.log(`  Market USDC in: $${ledger.flows.marketUsdcInUsd.toFixed(2)}`);
  console.log(`  Market USDC out: $${ledger.flows.marketUsdcOutUsd.toFixed(2)}`);
  console.log(`  External in: $${ledger.flows.externalInUsd.toFixed(2)}`);
  console.log(`  External out: $${ledger.flows.externalOutUsd.toFixed(2)}`);
  console.log("");
  console.log("Reconciliation");
  console.log(`  Trading PnL: ${fmtSignedUsd(ledger.reconciliation.tradingPnlUsd)}`);
  console.log(`  Estimated rewards (accrual): $${ledger.reconciliation.estimatedRewardsUsd.toFixed(6)}`);
  console.log(
    `  Implied non-trading: ${ledger.reconciliation.impliedNonTradingUsd === undefined ? "unknown" : fmtSignedUsd(ledger.reconciliation.impliedNonTradingUsd)}`,
  );
  console.log(`  External capital drift: ${fmtSignedUsd(ledger.reconciliation.externalCapitalDriftUsd)}`);
  console.log("");
  console.log("Scan");
  console.log(`  Pages scanned: ${ledger.scanMeta.pagesScanned}`);
  console.log(`  Transfers scanned: ${ledger.scanMeta.transfersScanned}`);
  if (ledger.scanMeta.cachedAt) console.log(`  Flow cache as of: ${ledger.scanMeta.cachedAt}`);
}

function fmtSignedUsd(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}$${value.toFixed(2)}`;
}
