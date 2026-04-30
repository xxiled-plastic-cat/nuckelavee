import { AlphaClient, type Market, type MarketOption, type OpenOrder, type WalletPosition } from "@alpha-arcade/sdk";
import algosdk from "algosdk";

import type { AlphaConfig } from "./alphaConfig.js";
import type { AlphaBookLevel, AlphaMarket, AlphaOrderbook, AlphaRewardInfo } from "./alphaTypes.js";

const MICRO = 1_000_000;

type AlphaRuntimeClient = AlphaClient & {
  createMarketOrder?: (input: {
    marketAppId: number;
    position: 0 | 1;
    price: number;
    quantity: number;
    isBuying: boolean;
    slippage: number;
  }) => Promise<{ escrowAppId?: number; txIds?: string[]; confirmedRound?: number; matchedQuantity?: number; actualFillPrice?: number }>;
  mergeShares?: (input: { marketAppId: number; amount: number }) => Promise<{ txIds?: string[]; confirmedRound?: number }>;
  splitShares?: (input: { marketAppId: number; amount: number }) => Promise<{ txIds?: string[]; confirmedRound?: number }>;
};

export function fromMicroUnits(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined || !Number.isFinite(value)) return undefined;
  return value / MICRO;
}

export function toMicroUnits(value: number): number {
  return Math.max(0, Math.floor(value * MICRO));
}

export function roundShares(value: number): number {
  return Math.floor(value * MICRO) / MICRO;
}

function normalizeApiPrice(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  if (value > 1) return value / MICRO;
  if (value < 0 || value > 1) return undefined;
  return value;
}

function normalizeUsd(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value > 10_000 ? value / MICRO : value;
}

function normalizeMarketVolumeUsd(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value > 10_000_000 ? value / MICRO : value;
}

function normalizeRewardSpreadCents(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  if (value > 10_000) return (value / MICRO) * 100;
  if (value > 100) return value / 10_000;
  if (value <= 1) return value * 100;
  return value;
}

function normalizeContracts(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return value > 10_000 ? value / MICRO : value;
}

function inferCompetition(market: Market | MarketOption): AlphaRewardInfo["competitionLevel"] {
  const raw = market.competitionLevel;
  if (raw === "low" || raw === "medium" || raw === "high") return raw;
  return "unknown";
}

function toRewardInfo(market: Market | MarketOption): AlphaRewardInfo {
  const looseMarket = market as Market | MarketOption & Record<string, unknown>;
  const totalRewardsUsd = normalizeUsd(market.totalRewards);
  const rewardsPaidOutUsd = normalizeUsd(market.rewardsPaidOut);
  const remainingRewardsUsd =
    totalRewardsUsd !== undefined && rewardsPaidOutUsd !== undefined
      ? Math.max(0, totalRewardsUsd - rewardsPaidOutUsd)
      : undefined;
  return {
    isRewardMarket: totalRewardsUsd !== undefined || rewardsPaidOutUsd !== undefined,
    totalRewardsUsd,
    rewardsPaidOutUsd,
    remainingRewardsUsd,
    dailyRewardsUsd: normalizeUsd(looseMarket.dailyRewards ?? looseMarket.dailyReward ?? looseMarket.rewardPerDay ?? looseMarket.totalRewards),
    lastPayoutUsd: normalizeUsd(market.lastRewardAmount),
    maxRewardSpreadCents: normalizeRewardSpreadCents(market.rewardsSpreadDistance),
    minContracts: normalizeContracts(market.rewardsMinContracts),
    competitionLevel: inferCompetition(market),
  };
}

function toMarketStatus(market: Market): string {
  if (market.isResolved) return "resolved";
  if (market.isLive === false) return "closed";
  return "live";
}

function flattenMarket(market: Market): AlphaMarket[] {
  if (market.options && market.options.length > 0) {
    return market.options.map((option) => {
      const looseOption = option as MarketOption & Record<string, unknown>;
      return {
        id: option.id ?? `${market.id}:${option.marketAppId}`,
        marketAppId: option.marketAppId,
        slug: market.slug,
        title: `${market.title} - ${option.title ?? looseOption.label ?? option.id}`,
        category: market.categories?.[0],
        status: toMarketStatus(market),
        closeTime: market.endTs ? new Date(market.endTs * 1000).toISOString() : undefined,
        endTs: market.endTs,
        resolved: Boolean(market.isResolved),
        yesPrice: normalizeApiPrice(option.yesProb),
        noPrice: normalizeApiPrice(option.noProb),
        volume: normalizeMarketVolumeUsd(looseOption.volume ?? market.volume),
        reward: toRewardInfo(option),
        raw: { market, option },
      };
    });
  }
  return [
    {
      id: market.id,
      marketAppId: market.marketAppId,
      slug: market.slug,
      title: market.title,
      category: market.categories?.[0],
      status: toMarketStatus(market),
      closeTime: market.endTs ? new Date(market.endTs * 1000).toISOString() : undefined,
      endTs: market.endTs,
      resolved: Boolean(market.isResolved),
      yesPrice: normalizeApiPrice(market.yesProb),
      noPrice: normalizeApiPrice(market.noProb),
      volume: normalizeMarketVolumeUsd(market.volume),
      reward: toRewardInfo(market),
      raw: market,
    },
  ];
}

function bestBid(levels: AlphaBookLevel[]): number | undefined {
  return levels.length > 0 ? Math.max(...levels.map((level) => level.price)) : undefined;
}

function bestAsk(levels: AlphaBookLevel[]): number | undefined {
  return levels.length > 0 ? Math.min(...levels.map((level) => level.price)) : undefined;
}

function normalizeLevels(entries: Array<{ price: number; quantity: number; escrowAppId?: number; owner?: string }>): AlphaBookLevel[] {
  return entries
    .map((entry) => ({
      price: fromMicroUnits(entry.price) ?? 0,
      quantityShares: fromMicroUnits(entry.quantity) ?? 0,
      escrowAppId: entry.escrowAppId,
      owner: entry.owner,
    }))
    .filter((entry) => entry.price > 0 && entry.price < 1 && entry.quantityShares > 0);
}

export class AlphaSdkClient {
  private readonly client: AlphaClient;
  private readonly algodClient: algosdk.Algodv2;
  private readonly usdcAssetId: number;

  constructor(config: AlphaConfig, liveSigner: boolean) {
    const account =
      liveSigner && config.walletMnemonic ? algosdk.mnemonicToSecretKey(config.walletMnemonic) : algosdk.generateAccount();
    this.algodClient = new algosdk.Algodv2("", config.algodServer, "");
    this.usdcAssetId = config.usdcAssetId;
    this.client = new AlphaClient({
      algodClient: this.algodClient,
      indexerClient: new algosdk.Indexer("", config.indexerServer, ""),
      signer: algosdk.makeBasicAccountTransactionSigner(account),
      activeAddress: liveSigner && config.walletAddress ? config.walletAddress : account.addr.toString(),
      matcherAppId: config.matcherAppId,
      usdcAssetId: config.usdcAssetId,
      apiKey: config.apiKey,
    });
  }

  async getLiveMarkets(): Promise<AlphaMarket[]> {
    const markets = await this.client.getLiveMarkets();
    return markets.flatMap(flattenMarket);
  }

  async getRewardMarkets(): Promise<AlphaMarket[]> {
    const markets = await this.client.getRewardMarkets();
    return markets.flatMap(flattenMarket).filter((market) => market.reward.isRewardMarket);
  }

  async getMarket(marketIdOrSlug: string): Promise<AlphaMarket | undefined> {
    const markets = await this.getLiveMarkets();
    return markets.find((market) => market.id === marketIdOrSlug || market.slug === marketIdOrSlug || String(market.marketAppId) === marketIdOrSlug);
  }

  async getOrderbook(market: AlphaMarket): Promise<AlphaOrderbook> {
    try {
      const book = await this.client.getOrderbook(market.marketAppId);
      const yesBids = normalizeLevels(book.yes.bids);
      const yesAsks = normalizeLevels(book.yes.asks);
      const noBids = normalizeLevels(book.no.bids);
      const noAsks = normalizeLevels(book.no.asks);
      const yesBid = bestBid(yesBids);
      const yesAsk = bestAsk(yesAsks);
      const noBid = bestBid(noBids);
      const noAsk = bestAsk(noAsks);
      const yesSpread = yesBid !== undefined && yesAsk !== undefined ? yesAsk - yesBid : undefined;
      const noSpread = noBid !== undefined && noAsk !== undefined ? noAsk - noBid : undefined;
      return {
        marketId: market.id,
        marketAppId: market.marketAppId,
        slug: market.slug,
        source: "onchain_orderbook",
        yesBid,
        yesAsk,
        noBid,
        noAsk,
        yesMid: yesBid !== undefined && yesAsk !== undefined ? (yesBid + yesAsk) / 2 : market.yesPrice,
        noMid: noBid !== undefined && noAsk !== undefined ? (noBid + noAsk) / 2 : market.noPrice,
        yesSpread,
        noSpread,
        bestSpread: Math.max(yesSpread ?? 0, noSpread ?? 0) || undefined,
        yesSideOrders: { bids: yesBids, asks: yesAsks },
        noSideOrders: { bids: noBids, asks: noAsks },
        raw: book,
      };
    } catch (error) {
      return {
        marketId: market.id,
        marketAppId: market.marketAppId,
        slug: market.slug,
        source: "unavailable",
        yesSideOrders: { bids: [], asks: [] },
        noSideOrders: { bids: [], asks: [] },
        raw: error,
      };
    }
  }

  async getPositions(walletAddress?: string): Promise<WalletPosition[]> {
    return this.client.getPositions(walletAddress);
  }

  async getOpenOrders(marketAppId: number, walletAddress?: string): Promise<OpenOrder[]> {
    return this.client.getOpenOrders(marketAppId, walletAddress);
  }

  async getWalletOpenOrders(walletAddress: string): Promise<OpenOrder[]> {
    return this.client.getWalletOrdersFromApi(walletAddress);
  }

  async getUsdcBalance(walletAddress: string): Promise<number | undefined> {
    try {
      const result = (await this.algodClient.accountAssetInformation(walletAddress, this.usdcAssetId).do()) as {
        assetHolding?: { amount?: number | bigint };
        assetHoldingInfo?: { amount?: number | bigint };
        amount?: number | bigint;
      };
      const amount = result.assetHolding?.amount ?? result.assetHoldingInfo?.amount ?? result.amount;
      if (amount === undefined) return 0;
      return Number(amount) / MICRO;
    } catch {
      return undefined;
    }
  }

  async getAlgoBalance(walletAddress: string): Promise<number | undefined> {
    try {
      const result = (await this.algodClient.accountInformation(walletAddress).do()) as {
        amount?: number | bigint;
      };
      if (result.amount === undefined) return 0;
      return Number(result.amount) / MICRO;
    } catch {
      return undefined;
    }
  }

  async createLimitOrder(input: {
    marketAppId: number;
    outcome: "YES" | "NO";
    price: number;
    sizeShares: number;
    isBuying: boolean;
  }): Promise<{ escrowAppId: number; txIds: string[]; confirmedRound: number }> {
    return this.client.createLimitOrder({
      marketAppId: input.marketAppId,
      position: input.outcome === "YES" ? 1 : 0,
      price: toMicroUnits(input.price),
      quantity: toMicroUnits(input.sizeShares),
      isBuying: input.isBuying,
    });
  }

  async createMarketOrder(input: {
    marketAppId: number;
    outcome: "YES" | "NO";
    price: number;
    sizeShares: number;
    isBuying: boolean;
    slippage: number;
  }): Promise<{ escrowAppId?: number; txIds: string[]; confirmedRound?: number; matchedQuantity?: number; actualFillPrice?: number }> {
    const runtimeClient = this.client as AlphaRuntimeClient;
    if (!runtimeClient.createMarketOrder) throw new Error("Alpha SDK does not expose createMarketOrder");
    const result = await runtimeClient.createMarketOrder({
      marketAppId: input.marketAppId,
      position: input.outcome === "YES" ? 1 : 0,
      price: toMicroUnits(input.price),
      quantity: toMicroUnits(input.sizeShares),
      isBuying: input.isBuying,
      slippage: toMicroUnits(input.slippage),
    });
    const looseResult = result as typeof result & { matchedQuantity?: number; actualFillPrice?: number };
    return {
      ...looseResult,
      txIds: looseResult.txIds ?? [],
      matchedQuantity: fromMicroUnits(looseResult.matchedQuantity),
      actualFillPrice: fromMicroUnits(looseResult.actualFillPrice),
    };
  }

  async mergeShares(input: { marketAppId: number; amountShares: number }): Promise<{ txIds: string[]; confirmedRound?: number }> {
    const runtimeClient = this.client as AlphaRuntimeClient;
    if (!runtimeClient.mergeShares) throw new Error("Alpha SDK does not expose mergeShares");
    const result = await runtimeClient.mergeShares({
      marketAppId: input.marketAppId,
      amount: toMicroUnits(input.amountShares),
    });
    return { ...result, txIds: result.txIds ?? [] };
  }

  async splitShares(input: { marketAppId: number; amountUsd: number }): Promise<{ txIds: string[]; confirmedRound?: number }> {
    const runtimeClient = this.client as AlphaRuntimeClient;
    if (!runtimeClient.splitShares) throw new Error("Alpha SDK does not expose splitShares");
    const result = await runtimeClient.splitShares({
      marketAppId: input.marketAppId,
      amount: toMicroUnits(input.amountUsd),
    });
    return { ...result, txIds: result.txIds ?? [] };
  }

  async cancelOrder(input: { marketAppId: number; escrowAppId: number; orderOwner: string }): Promise<{ success: boolean }> {
    return this.client.cancelOrder(input);
  }
}
