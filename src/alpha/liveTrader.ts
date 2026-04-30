import type { AlphaConfig, AlphaMode } from "./alphaConfig.js";
import { validateLiveConfig } from "./alphaConfig.js";
import { AlphaSdkClient, fromMicroUnits } from "./alphaClient.js";
import { checkQuoteRisk } from "./alphaRiskManager.js";
import { loadAlphaState, saveAlphaState } from "./alphaStateStore.js";
import type { AlphaBotState, AlphaMarket, AlphaOrderbook, AlphaOutcome, AlphaPaperOrder, AlphaQuote } from "./alphaTypes.js";
import type { AlphaScanResult } from "./alphaMarketScanner.js";
import { generateQuotes } from "./quoteEngine.js";
import { runParityLane } from "./parityTrader.js";
import type { OpenOrder, WalletPosition } from "@alpha-arcade/sdk";

export type LiveAction = {
  kind: "place" | "cancel" | "skip" | "parity";
  message: string;
};

export type LiveTickResult = {
  actions: LiveAction[];
  state: AlphaBotState;
  walletUsdcBalanceUsd?: number;
  walletAlgoBalance?: number;
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

function toTrackedOpenOrder(order: OpenOrder, market: AlphaMarket | undefined): AlphaPaperOrder {
  const now = new Date().toISOString();
  const price = fromMicroUnits(order.price) ?? 0;
  const quantity = fromMicroUnits(order.quantity) ?? 0;
  const filledShares = fromMicroUnits(order.quantityFilled) ?? 0;
  const remainingShares = Math.max(0, quantity - filledShares);
  const side = order.side === 1 ? "bid" : "ask";
  return {
    id: `live:${order.escrowAppId}`,
    runMode: "live",
    marketId: market?.id ?? String(order.marketAppId),
    marketAppId: order.marketAppId,
    slug: market?.slug,
    title: market?.title ?? `market ${order.marketAppId}`,
    outcome: order.position === 1 ? "YES" : "NO",
    side,
    price,
    sizeShares: quantity,
    notionalUsd: side === "bid" ? price * remainingShares : 0,
    reason: "reconciled from live wallet open orders",
    rewardEligible: false,
    source: "spread",
    createdAt: now,
    updatedAt: now,
    status: "open",
    reservedUsd: side === "bid" ? price * remainingShares : 0,
    filledShares,
    remainingShares,
    liveEscrowAppId: order.escrowAppId,
    owner: order.owner,
  };
}

function quoteKey(value: Pick<AlphaQuote, "marketAppId" | "outcome" | "side" | "source">): string {
  return `${value.marketAppId}:${value.outcome}:${value.side}:${value.source}`;
}

function quoteDeltaCents(order: AlphaPaperOrder, quote: AlphaQuote): number {
  return Math.abs(order.price - quote.price) * 100;
}

function isEquivalentQuote(order: AlphaPaperOrder, quote: AlphaQuote, config: AlphaConfig): boolean {
  if (quoteKey(order) !== quoteKey(quote)) return false;
  return quoteDeltaCents(order, quote) <= config.quoteRefreshThresholdCents;
}

function orderAgeSeconds(order: Pick<AlphaPaperOrder, "createdAt">): number {
  const created = Date.parse(order.createdAt);
  return Number.isFinite(created) ? Math.max(0, (Date.now() - created) / 1000) : 0;
}

function mergeLiveOrdersFromWallet(
  state: AlphaBotState,
  orders: OpenOrder[],
  marketByAppId: Map<number, AlphaMarket>,
): { synced: number; closedOrders: AlphaPaperOrder[] } {
  const previousLiveByEscrow = new Map(
    state.openOrders
      .filter((order) => order.runMode === "live" && order.liveEscrowAppId !== undefined)
      .map((order) => [order.liveEscrowAppId, order]),
  );
  const openLive = orders
    .filter((order) => order.quantity > order.quantityFilled)
    .map((order) => {
      const tracked = toTrackedOpenOrder(order, marketByAppId.get(order.marketAppId));
      const previous = previousLiveByEscrow.get(order.escrowAppId);
      if (!previous) return tracked;
      return {
        ...previous,
        ...tracked,
        rewardEligible: previous.rewardEligible,
        rewardZoneDistanceCents: previous.rewardZoneDistanceCents,
        rewardMinContracts: previous.rewardMinContracts,
        estimatedRewardUsdPerDay: previous.estimatedRewardUsdPerDay,
        source: previous.source,
        reason: previous.reason,
        createdAt: previous.createdAt,
        liveTxIds: previous.liveTxIds,
      };
    });

  const liveEscrows = new Set(openLive.map((order) => order.liveEscrowAppId));
  const closedOrders: AlphaPaperOrder[] = [];
  for (const previous of previousLiveByEscrow.values()) {
    if (previous.liveEscrowAppId !== undefined && !liveEscrows.has(previous.liveEscrowAppId)) {
      closedOrders.push(previous);
    }
  }
  state.openOrders = [...state.openOrders.filter((order) => order.runMode !== "live"), ...openLive];
  return { synced: openLive.length, closedOrders };
}

function mergeLivePositionsFromWallet(state: AlphaBotState, positions: WalletPosition[], marketByAppId: Map<number, AlphaMarket>): number {
  let synced = 0;
  for (const position of positions) {
    const yesShares = fromMicroUnits(position.yesBalance) ?? 0;
    const noShares = fromMicroUnits(position.noBalance) ?? 0;
    if (yesShares <= 0 && noShares <= 0) continue;
    const market = marketByAppId.get(position.marketAppId);
    const marketId = market?.id ?? String(position.marketAppId);
    const previous = state.positionsByMarket[marketId];
    state.positionsByMarket[marketId] = {
      marketId,
      marketAppId: position.marketAppId,
      slug: market?.slug ?? previous?.slug,
      title: market?.title ?? previous?.title ?? position.title,
      yesShares,
      noShares,
      avgYesCost: previous?.avgYesCost ?? 0,
      avgNoCost: previous?.avgNoCost ?? 0,
      realisedPnl: previous?.realisedPnl ?? 0,
      unrealisedPnl: previous?.unrealisedPnl ?? 0,
      lastMark: previous?.lastMark,
    };
    synced += 1;
  }
  return synced;
}

function positionShareCount(position: { yesShares: number; noShares: number }, outcome: AlphaOutcome): number {
  return outcome === "YES" ? position.yesShares : position.noShares;
}

type PositionSnapshot = Record<string, { yesShares: number; noShares: number; avgYesCost: number; avgNoCost: number }>;

function snapshotPositions(state: AlphaBotState): PositionSnapshot {
  return Object.fromEntries(
    Object.entries(state.positionsByMarket).map(([marketId, position]) => [
      marketId,
      {
        yesShares: position.yesShares,
        noShares: position.noShares,
        avgYesCost: position.avgYesCost,
        avgNoCost: position.avgNoCost,
      },
    ]),
  );
}

function walletPositionSnapshot(positions: WalletPosition[], marketByAppId: Map<number, AlphaMarket>): PositionSnapshot {
  const snapshot: PositionSnapshot = {};
  for (const position of positions) {
    const market = marketByAppId.get(position.marketAppId);
    const marketId = market?.id ?? String(position.marketAppId);
    snapshot[marketId] = {
      yesShares: fromMicroUnits(position.yesBalance) ?? 0,
      noShares: fromMicroUnits(position.noBalance) ?? 0,
      avgYesCost: 0,
      avgNoCost: 0,
    };
  }
  return snapshot;
}

function ensureLivePosition(state: AlphaBotState, order: AlphaPaperOrder) {
  state.positionsByMarket[order.marketId] ??= {
    marketId: order.marketId,
    marketAppId: order.marketAppId,
    slug: order.slug,
    title: order.title,
    yesShares: 0,
    noShares: 0,
    avgYesCost: 0,
    avgNoCost: 0,
    realisedPnl: 0,
    unrealisedPnl: 0,
  };
  return state.positionsByMarket[order.marketId];
}

function inferClosedLiveOrders(
  state: AlphaBotState,
  closedOrders: AlphaPaperOrder[],
  beforePositions: PositionSnapshot,
  walletPositions: PositionSnapshot,
  actions: LiveAction[],
): void {
  const now = new Date().toISOString();
  for (const order of closedOrders) {
    const before = beforePositions[order.marketId] ?? { yesShares: 0, noShares: 0, avgYesCost: 0, avgNoCost: 0 };
    const wallet = walletPositions[order.marketId] ?? { yesShares: 0, noShares: 0, avgYesCost: 0, avgNoCost: 0 };
    const beforeShares = order.outcome === "YES" ? before.yesShares : before.noShares;
    const walletShares = order.outcome === "YES" ? wallet.yesShares : wallet.noShares;
    const fill = order.side === "bid" ? Math.min(order.remainingShares, Math.max(0, walletShares - beforeShares)) : Math.min(order.remainingShares, Math.max(0, beforeShares - walletShares));

    if (fill <= 0.000001) {
      state.cancelledOrders.push({ ...order, status: "cancelled", updatedAt: now });
      continue;
    }

    const position = ensureLivePosition(state, order);
    const filled = { ...order, status: "filled" as const, filledShares: order.filledShares + fill, remainingShares: Math.max(0, order.remainingShares - fill), updatedAt: now };
    if (order.side === "bid") {
      const avgCost = order.outcome === "YES" ? before.avgYesCost : before.avgNoCost;
      const newShares = Math.max(beforeShares + fill, walletShares);
      const newAvg = newShares > 0 ? (beforeShares * avgCost + fill * order.price) / newShares : 0;
      if (order.outcome === "YES") {
        position.yesShares = newShares;
        position.avgYesCost = newAvg;
      } else {
        position.noShares = newShares;
        position.avgNoCost = newAvg;
      }
      if (order.source === "spread") state.strategyStats.spreadEntryFills += 1;
      actions.push({ kind: "skip", message: `Inferred live fill ${order.title} ${order.outcome} bid ${fill.toFixed(6)} share(s) at ${order.price.toFixed(3)}` });
    } else {
      const avgCost = order.outcome === "YES" ? before.avgYesCost : before.avgNoCost;
      const pnl = (order.price - avgCost) * fill;
      if (order.outcome === "YES") {
        position.yesShares = walletShares;
        if (walletShares <= 0) position.avgYesCost = 0;
      } else {
        position.noShares = walletShares;
        if (walletShares <= 0) position.avgNoCost = 0;
      }
      position.realisedPnl += pnl;
      state.realisedPnl += pnl;
      if (order.source === "inventory_exit") {
        state.strategyStats.spreadExitFills += 1;
        state.strategyStats.spreadRealisedPnl += pnl;
      }
      actions.push({
        kind: "skip",
        message: `Inferred live exit fill ${order.title} ${order.outcome} ask ${fill.toFixed(6)} share(s) at ${order.price.toFixed(3)}; spreadPnl=${fmtSignedUsd(pnl)}`,
      });
    }
    state.fills.push(filled);
  }
}

function fmtSignedUsd(value: number): string {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(4)}`;
}

function getOutcomeBook(book: AlphaOrderbook, outcome: AlphaOutcome): { bid?: number; ask?: number; mid?: number; spread?: number } {
  return outcome === "YES"
    ? { bid: book.yesBid, ask: book.yesAsk, mid: book.yesMid, spread: book.yesSpread }
    : { bid: book.noBid, ask: book.noAsk, mid: book.noMid, spread: book.noSpread };
}

function bestExternalDepthUsd(levels: Array<{ price: number; quantityShares: number; owner?: string }>, walletAddress?: string): number {
  const level = levels.find((candidate) => candidate.owner === undefined || candidate.owner !== walletAddress);
  return level ? level.price * level.quantityShares : 0;
}

function outcomeDepthUsd(book: AlphaOrderbook, outcome: AlphaOutcome, walletAddress?: string): number {
  const orders = outcome === "YES" ? book.yesSideOrders : book.noSideOrders;
  return Math.min(bestExternalDepthUsd(orders.bids, walletAddress), bestExternalDepthUsd(orders.asks, walletAddress));
}

function outcomeIsTwoSided(book: AlphaOrderbook, outcome: AlphaOutcome, walletAddress?: string): boolean {
  const outcomeBook = getOutcomeBook(book, outcome);
  return (
    outcomeBook.bid !== undefined &&
    outcomeBook.ask !== undefined &&
    outcomeBook.mid !== undefined &&
    outcomeBook.spread !== undefined &&
    outcomeDepthUsd(book, outcome, walletAddress) > 0
  );
}

function updateSpreadMarketStats(
  state: AlphaBotState,
  scan: AlphaScanResult,
  marketByAppId: Map<number, AlphaMarket>,
  config: AlphaConfig,
): number {
  const now = new Date().toISOString();
  let updated = 0;
  for (const [marketAppId, book] of scan.orderbooks) {
    const market = marketByAppId.get(marketAppId);
    if (!market) continue;
    const outcomes = (["YES", "NO"] as const)
      .map((outcome) => {
        const outcomeBook = getOutcomeBook(book, outcome);
        return {
          outcome,
          twoSided: outcomeIsTwoSided(book, outcome, config.walletAddress),
          depthUsd: outcomeDepthUsd(book, outcome, config.walletAddress),
          spreadCents: outcomeBook.spread !== undefined ? outcomeBook.spread * 100 : undefined,
        };
      })
      .filter((outcome) => outcome.twoSided);
    const best = outcomes.sort((a, b) => b.depthUsd - a.depthUsd)[0];
    const key = String(marketAppId);
    const previous = state.spreadStatsByMarket[key];
    const twoSided = best !== undefined;
    state.spreadStatsByMarket[key] = {
      marketId: market.id,
      marketAppId,
      title: market.title,
      volume: market.volume,
      observedScans: (previous?.observedScans ?? 0) + 1,
      consecutiveTwoSidedScans: twoSided ? (previous?.consecutiveTwoSidedScans ?? 0) + 1 : 0,
      bestDepthUsd: best?.depthUsd,
      bestSpreadCents: best?.spreadCents,
      lastTwoSidedAt: twoSided ? now : previous?.lastTwoSidedAt,
      lastSeenAt: now,
    };
    updated += 1;
  }
  return updated;
}

function spreadEntryRejection(quote: AlphaQuote, state: AlphaBotState, config: AlphaConfig): string | undefined {
  if (quote.source !== "spread" || quote.side !== "bid") return undefined;
  const stats = state.spreadStatsByMarket[String(quote.marketAppId)];
  if (!stats) return "spread market has not been observed yet";
  if ((stats.volume ?? 0) < config.minSpreadVolumeUsd) {
    return `volume ${(stats.volume ?? 0).toFixed(2)} below spread minimum ${config.minSpreadVolumeUsd.toFixed(2)}`;
  }
  if (stats.consecutiveTwoSidedScans < config.spreadPersistenceScans) {
    return `two-sided book only persisted ${stats.consecutiveTwoSidedScans}/${config.spreadPersistenceScans} scan(s)`;
  }
  if ((stats.bestDepthUsd ?? 0) < config.minSpreadDepthUsd) {
    return `visible same-outcome depth $${(stats.bestDepthUsd ?? 0).toFixed(2)} below minimum $${config.minSpreadDepthUsd.toFixed(2)}`;
  }
  if ((stats.bestSpreadCents ?? 0) < config.minSpreadCaptureCents) {
    return `spread ${(stats.bestSpreadCents ?? 0).toFixed(2)}c below minimum ${config.minSpreadCaptureCents.toFixed(2)}c`;
  }
  return undefined;
}

function spreadQuoteQuality(quote: AlphaQuote, state: AlphaBotState): number {
  const stats = state.spreadStatsByMarket[String(quote.marketAppId)];
  if (!stats) return 0;
  return Math.log10((stats.volume ?? 0) + 1) * 10 + (stats.bestDepthUsd ?? 0) + (stats.bestSpreadCents ?? 0);
}

function findMarketForPosition(
  position: AlphaBotState["positionsByMarket"][string],
  marketByAppId: Map<number, AlphaMarket>,
): AlphaMarket | undefined {
  if (position.marketAppId !== undefined) return marketByAppId.get(position.marketAppId);
  return [...marketByAppId.values()].find((market) => market.id === position.marketId);
}

function describeMissingExit(
  position: AlphaBotState["positionsByMarket"][string],
  outcome: AlphaOutcome,
  market: AlphaMarket | undefined,
  book: AlphaOrderbook | undefined,
  config: AlphaConfig,
): string {
  if (!market) return "market metadata was not in this scan";
  if (!book) return "orderbook was not scanned for this market";
  const outcomeBook = getOutcomeBook(book, outcome);
  if (outcomeBook.mid === undefined) return "same-outcome midpoint unavailable";
  const spreadMidpointAllowed = outcomeBook.mid >= config.minSpreadExitMidpoint && outcomeBook.mid <= config.maxSpreadMidpoint;
  const rewardMidpointAllowed = outcomeBook.mid >= config.minMidpoint && outcomeBook.mid <= config.maxMidpoint;
  if (market.reward.isRewardMarket && market.reward.maxRewardSpreadCents !== undefined && rewardMidpointAllowed) {
    const rewardAsk = outcomeBook.mid + config.rewardZoneBufferCents / 100;
    if (rewardAsk <= 0 || rewardAsk >= 1) return `reward-zone ask ${rewardAsk.toFixed(3)} outside valid price range`;
    return "reward-zone exit looked possible but no quote was produced";
  }
  if (!spreadMidpointAllowed) {
    return `midpoint ${outcomeBook.mid.toFixed(3)} outside spread exit bounds ${config.minSpreadExitMidpoint.toFixed(3)}-${config.maxSpreadMidpoint.toFixed(3)}`;
  }
  if (!config.enableSpreadCapture) return "spread capture is disabled";
  if (outcomeBook.bid === undefined || outcomeBook.ask === undefined || outcomeBook.spread === undefined) {
    return `missing same-outcome book side(s): bid=${outcomeBook.bid?.toFixed(3) ?? "n/a"}, ask=${outcomeBook.ask?.toFixed(3) ?? "n/a"}, spread=${
      outcomeBook.spread !== undefined ? `${(outcomeBook.spread * 100).toFixed(2)}c` : "n/a"
    }`;
  }
  const edge = Math.min(config.spreadExitEdgeCents / 100, outcomeBook.spread / 4);
  const ask = Math.max(outcomeBook.mid + edge, outcomeBook.bid + 0.000001);
  if (ask <= outcomeBook.bid || ask >= outcomeBook.ask) {
    return `no room for exit ask inside spread: bid ${outcomeBook.bid.toFixed(3)}, ask ${outcomeBook.ask.toFixed(3)}, target ${ask.toFixed(3)}`;
  }
  const shares = positionShareCount(position, outcome);
  return `exit looked possible for ${shares.toFixed(6)} share(s) but no quote was produced`;
}

function addInventoryExitDiagnostics(
  actions: LiveAction[],
  state: AlphaBotState,
  quotes: AlphaQuote[],
  scan: AlphaScanResult,
  marketByAppId: Map<number, AlphaMarket>,
  config: AlphaConfig,
): void {
  const positions = Object.values(state.positionsByMarket).filter((position) => position.yesShares > 0 || position.noShares > 0);
  if (positions.length === 0) {
    actions.push({ kind: "skip", message: "Inventory audit: no held YES/NO shares in bot state" });
    return;
  }

  for (const position of positions) {
    const market = findMarketForPosition(position, marketByAppId);
    const marketAppId = position.marketAppId ?? market?.marketAppId;
    const book = marketAppId !== undefined ? scan.orderbooks.get(marketAppId) : undefined;
    actions.push({
      kind: "skip",
      message: `Inventory audit: ${position.title} YES=${position.yesShares.toFixed(6)} NO=${position.noShares.toFixed(6)}`,
    });
    for (const outcome of ["YES", "NO"] as const) {
      const shares = positionShareCount(position, outcome);
      if (shares <= 0) continue;
      const exit = quotes.find((quote) => quote.source === "inventory_exit" && quote.marketId === position.marketId && quote.outcome === outcome);
      if (exit) {
        actions.push({
          kind: "skip",
          message: `Exit audit: planned ${position.title} ${outcome} ask ${exit.price.toFixed(3)} for ${exit.sizeShares.toFixed(6)} share(s); ${exit.reason}`,
        });
        continue;
      }
      actions.push({
        kind: "skip",
        message: `Exit audit: no ${position.title} ${outcome} exit for ${shares.toFixed(6)} share(s): ${describeMissingExit(position, outcome, market, book, config)}`,
      });
    }
  }
}

async function loadWalletOpenOrders(
  liveClient: AlphaSdkClient,
  walletAddress: string,
  marketByAppId: Map<number, AlphaMarket>,
): Promise<OpenOrder[]> {
  try {
    return await liveClient.getWalletOpenOrders(walletAddress);
  } catch {
    const results = await Promise.allSettled(
      [...marketByAppId.keys()].map((marketAppId) => liveClient.getOpenOrders(marketAppId, walletAddress)),
    );
    return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  }
}

function rankDiversifiedQuotes(quotes: AlphaQuote[], state: AlphaBotState, config: AlphaConfig): AlphaQuote[] {
  const openByMarket = new Map<number, number>();
  const openOutcomesByMarket = new Map<number, Set<AlphaQuote["outcome"]>>();
  const openRewardContractsByMarket = new Map<number, number>();
  for (const order of state.openOrders.filter((candidate) => candidate.runMode === "live" && candidate.status === "open")) {
    openByMarket.set(order.marketAppId, (openByMarket.get(order.marketAppId) ?? 0) + 1);
    if (!openOutcomesByMarket.has(order.marketAppId)) openOutcomesByMarket.set(order.marketAppId, new Set());
    openOutcomesByMarket.get(order.marketAppId)?.add(order.outcome);
    if (order.rewardEligible) {
      openRewardContractsByMarket.set(order.marketAppId, (openRewardContractsByMarket.get(order.marketAppId) ?? 0) + order.remainingShares);
    }
  }

  const selected: AlphaQuote[] = [];
  const selectedByMarket = new Map<number, number>();
  const selectedOutcomesByMarket = new Map<number, Set<AlphaQuote["outcome"]>>();
  const groupedQuotes = new Map<number, AlphaQuote[]>();
  for (const quote of quotes) {
    const alreadyOpen = state.openOrders.some(
      (order) => order.runMode === "live" && order.status === "open" && isEquivalentQuote(order, quote, config),
    );
    if (alreadyOpen) continue;
    if (!groupedQuotes.has(quote.marketAppId)) groupedQuotes.set(quote.marketAppId, []);
    groupedQuotes.get(quote.marketAppId)?.push(quote);
  }

  const selectQuote = (quote: AlphaQuote): void => {
    selected.push(quote);
    selectedByMarket.set(quote.marketAppId, (selectedByMarket.get(quote.marketAppId) ?? 0) + 1);
    if (!selectedOutcomesByMarket.has(quote.marketAppId)) selectedOutcomesByMarket.set(quote.marketAppId, new Set());
    selectedOutcomesByMarket.get(quote.marketAppId)?.add(quote.outcome);
  };

  const quoteScore = (quote: AlphaQuote): number => {
    if (quote.source === "inventory_exit") return 0;
    if (quote.rewardEligible) return 1;
    if (quote.source === "spread") return 2;
    return 3;
  };

  const compareQuotes = (a: AlphaQuote, b: AlphaQuote): number => {
    const scoreDiff = quoteScore(a) - quoteScore(b);
    if (scoreDiff !== 0) return scoreDiff;
    if (a.source === "spread" && b.source === "spread") return spreadQuoteQuality(b, state) - spreadQuoteQuality(a, state);
    return b.notionalUsd - a.notionalUsd;
  };

  for (const marketQuotes of groupedQuotes.values()) {
    marketQuotes.sort(compareQuotes);
    const openCount = openByMarket.get(marketQuotes[0]?.marketAppId ?? 0) ?? 0;
    const room = Math.max(0, config.maxLiveOrdersPerMarket - openCount);
    if (room <= 0) continue;

    const minContracts = Math.max(...marketQuotes.map((quote) => quote.rewardMinContracts ?? 0));
    const openRewardContracts = openRewardContractsByMarket.get(marketQuotes[0]?.marketAppId ?? 0) ?? 0;
    const availableRewardContracts = marketQuotes
      .filter((quote) => quote.rewardEligible)
      .slice(0, room)
      .reduce((sum, quote) => sum + quote.sizeShares, openRewardContracts);
    const rewardMinimumReachable = minContracts === 0 || availableRewardContracts >= minContracts;

    const openOutcomes = openOutcomesByMarket.get(marketQuotes[0]?.marketAppId ?? 0) ?? new Set<AlphaQuote["outcome"]>();
    const pairableRewardBids = rewardMinimumReachable
      ? marketQuotes.filter((quote) => quote.rewardEligible && quote.side === "bid" && !openOutcomes.has(quote.outcome))
      : [];
    const yes = pairableRewardBids.find((quote) => quote.outcome === "YES");
    const no = pairableRewardBids.find((quote) => quote.outcome === "NO");
    if (room >= 2 && yes && no) {
      selectQuote(yes);
      selectQuote(no);
      continue;
    }

    const exitQuote = marketQuotes.find((quote) => quote.source === "inventory_exit");
    const spreadQuote = marketQuotes.find((quote) => quote.source === "spread" && quote.side === "bid" && !openOutcomes.has(quote.outcome));
    const preferred = exitQuote ?? pairableRewardBids[0] ?? spreadQuote ?? marketQuotes.find((quote) => !openOutcomes.has(quote.outcome)) ?? marketQuotes[0];
    if (preferred) selectQuote(preferred);
  }

  for (const marketQuotes of groupedQuotes.values()) {
    marketQuotes.sort(compareQuotes);
    for (const quote of marketQuotes) {
      if (selected.includes(quote)) continue;
      const marketCount = (openByMarket.get(quote.marketAppId) ?? 0) + (selectedByMarket.get(quote.marketAppId) ?? 0);
      if (marketCount >= config.maxLiveOrdersPerMarket) continue;
      const usedOutcomes = new Set([
        ...(openOutcomesByMarket.get(quote.marketAppId) ?? new Set<AlphaQuote["outcome"]>()),
        ...(selectedOutcomesByMarket.get(quote.marketAppId) ?? new Set<AlphaQuote["outcome"]>()),
      ]);
      if (usedOutcomes.has(quote.outcome)) continue;
      selectQuote(quote);
    }
  }
  return selected;
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
  const walletAlgoBalance = await liveClient.getAlgoBalance(config.walletAddress);
  const actions: LiveAction[] = [];
  const marketByAppId = new Map<number, AlphaMarket>();
  for (const market of [...scan.markets, ...scan.rewardMarkets]) {
    marketByAppId.set(market.marketAppId, market);
  }

  const beforePositions = snapshotPositions(state);
  const walletOrders = await loadWalletOpenOrders(liveClient, config.walletAddress, marketByAppId);
  const { synced: syncedLiveOrders, closedOrders } = mergeLiveOrdersFromWallet(state, walletOrders, marketByAppId);
  actions.push({ kind: "skip", message: `Synced ${syncedLiveOrders} open live order(s) from wallet` });
  let walletPositions: PositionSnapshot = {};
  let positionsSynced = false;
  try {
    const positions = await liveClient.getPositions(config.walletAddress);
    walletPositions = walletPositionSnapshot(positions, marketByAppId);
    positionsSynced = true;
    const syncedPositions = mergeLivePositionsFromWallet(state, positions, marketByAppId);
    actions.push({ kind: "skip", message: `Synced ${syncedPositions} live position(s) from wallet` });
  } catch (error) {
    actions.push({ kind: "skip", message: `Position sync skipped: ${error instanceof Error ? error.message : String(error)}` });
  }
  if (positionsSynced) {
    inferClosedLiveOrders(state, closedOrders, beforePositions, walletPositions, actions);
  } else {
    state.cancelledOrders.push(...closedOrders.map((order) => ({ ...order, status: "cancelled" as const, updatedAt: new Date().toISOString() })));
  }
  const spreadStatsUpdated = updateSpreadMarketStats(state, scan, marketByAppId, config);
  actions.push({ kind: "skip", message: `Spread guardrails: updated ${spreadStatsUpdated} market health observation(s)` });

  const quotes: AlphaQuote[] = [];
  let blockedSpreadEntries = 0;
  for (const market of marketByAppId.values()) {
    const book = scan.orderbooks.get(market.marketAppId);
    if (!book) continue;
    for (const quote of generateQuotes(market, book, state, config)) {
      const rejection = spreadEntryRejection(quote, state, config);
      if (rejection) {
        blockedSpreadEntries += 1;
        actions.push({ kind: "skip", message: `Spread guardrail blocked ${quote.title} ${quote.outcome}: ${rejection}` });
        continue;
      }
      quotes.push(quote);
    }
  }
  actions.push({
    kind: "skip",
    message: `Generated ${quotes.length} quote candidate(s): reward=${quotes.filter((quote) => quote.source === "reward").length}, spread=${
      quotes.filter((quote) => quote.source === "spread").length
    }, exits=${quotes.filter((quote) => quote.source === "inventory_exit").length}, blockedSpreadEntries=${blockedSpreadEntries}`,
  });
  addInventoryExitDiagnostics(actions, state, quotes, scan, marketByAppId, config);
  const intendedQuoteByKey = new Map<string, AlphaQuote>();
  for (const quote of quotes) {
    if (!intendedQuoteByKey.has(quoteKey(quote))) intendedQuoteByKey.set(quoteKey(quote), quote);
  }

  for (const order of state.openOrders.filter((candidate) => candidate.runMode === "live" && candidate.status === "open")) {
    const escrowAppId = order.liveEscrowAppId;
    if (escrowAppId === undefined) continue;
    const intended = intendedQuoteByKey.get(quoteKey(order));
    if (intended && isEquivalentQuote(order, intended, config)) {
      order.reason = intended.reason;
      order.rewardEligible = intended.rewardEligible;
      order.rewardZoneDistanceCents = intended.rewardZoneDistanceCents;
      order.rewardMinContracts = intended.rewardMinContracts;
      order.estimatedRewardUsdPerDay = intended.estimatedRewardUsdPerDay;
      order.source = intended.source;
      actions.push({
        kind: "skip",
        message: `Kept live order escrowAppId=${escrowAppId}; quote still valid within ${config.quoteRefreshThresholdCents.toFixed(2)}c`,
      });
      continue;
    }
    const reason = intended
      ? `current quote moved ${quoteDeltaCents(order, intended).toFixed(2)}c`
      : "market no longer has a qualifying quote";
    if (order.source === "inventory_exit" && order.side === "ask" && orderAgeSeconds(order) < config.spreadExitMinDwellSeconds) {
      actions.push({
        kind: "skip",
        message: `Kept inventory exit escrowAppId=${escrowAppId}; resting ${Math.floor(orderAgeSeconds(order))}s/${config.spreadExitMinDwellSeconds}s before reconsidering`,
      });
      continue;
    }
    if (order.source === "spread" && order.side === "bid" && orderAgeSeconds(order) < config.spreadEntryMinDwellSeconds) {
      actions.push({
        kind: "skip",
        message: `Kept spread entry escrowAppId=${escrowAppId}; resting ${Math.floor(orderAgeSeconds(order))}s/${config.spreadEntryMinDwellSeconds}s before reconsidering`,
      });
      continue;
    }
    if (walletAlgoBalance !== undefined && walletAlgoBalance < config.minAlgoBalance) {
      actions.push({
        kind: "skip",
        message: `${mode === "live-dry-run" ? "Live would skip" : "Skipped"} cancel escrowAppId=${escrowAppId}; ${reason}; wallet ALGO ${walletAlgoBalance.toFixed(
          6,
        )} below safety floor ${config.minAlgoBalance.toFixed(2)}`,
      });
      continue;
    }
    if (mode === "live-dry-run") {
      actions.push({ kind: "cancel", message: `Would cancel live order escrowAppId=${escrowAppId}; ${reason}` });
      continue;
    }
    try {
      const result = await liveClient.cancelOrder({
        marketAppId: order.marketAppId,
        escrowAppId,
        orderOwner: order.owner ?? config.walletAddress,
      });
      if (result.success) {
        order.status = "cancelled";
        order.updatedAt = new Date().toISOString();
        state.cancelledOrders.push({ ...order });
        state.strategyStats.liveOrdersCancelled += 1;
        actions.push({ kind: "cancel", message: `Cancelled live order escrowAppId=${escrowAppId}; ${reason}` });
        await saveAlphaState(config.stateKey, state);
      }
    } catch (error) {
      actions.push({ kind: "skip", message: `Cancel failed escrowAppId=${escrowAppId}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  state.openOrders = state.openOrders.filter((order) => order.status === "open");

  if (walletAlgoBalance !== undefined && walletAlgoBalance < config.minAlgoBalance) {
    actions.push({
      kind: "skip",
      message: `${mode === "live-dry-run" ? "Live would skip" : "No live"} placements; wallet ALGO ${walletAlgoBalance.toFixed(
        6,
      )} below safety floor ${config.minAlgoBalance.toFixed(2)}`,
    });
    if (mode === "live") await saveAlphaState(config.stateKey, state);
    return { actions, state, walletUsdcBalanceUsd, walletAlgoBalance };
  }

  const openLiveOrders = state.openOrders.filter((order) => order.runMode === "live" && order.status === "open" && order.liveEscrowAppId !== undefined);
  const slots = Math.max(0, config.maxLiveOpenOrders - openLiveOrders.length);
  actions.push(
    ...(await runParityLane({
      scan,
      state,
      config,
      liveClient,
      mode,
      walletUsdcBalanceUsd,
      walletAlgoBalance,
      availableSlots: slots,
    })),
  );
  if (slots === 0) {
    actions.push({ kind: "skip", message: "No live order slots available under ALGO MBR-aware cap" });
    if (mode === "live") await saveAlphaState(config.stateKey, state);
    return { actions, state, walletUsdcBalanceUsd, walletAlgoBalance };
  }

  const rankedQuotes = rankDiversifiedQuotes(quotes, state, config);
  const pendingExitSlots = Math.min(
    config.spreadExitSlotReserve,
    rankedQuotes.filter((quote) => quote.source === "inventory_exit").length,
  );
  const bidSlotLimit = Math.max(0, slots - pendingExitSlots);
  if (pendingExitSlots > 0) {
    actions.push({ kind: "skip", message: `Reserved ${pendingExitSlots} live order slot(s) for inventory exits` });
  }
  const rewardWindow = rankedQuotes.slice(0, slots);
  const selectedRewardContractsByMarket = new Map<number, number>();
  for (const order of state.openOrders.filter((candidate) => candidate.runMode === "live" && candidate.status === "open" && candidate.rewardEligible)) {
    selectedRewardContractsByMarket.set(order.marketAppId, (selectedRewardContractsByMarket.get(order.marketAppId) ?? 0) + order.remainingShares);
  }
  for (const quote of rewardWindow.filter((candidate) => candidate.rewardEligible)) {
    selectedRewardContractsByMarket.set(quote.marketAppId, (selectedRewardContractsByMarket.get(quote.marketAppId) ?? 0) + quote.sizeShares);
  }

  let slotsUsed = 0;
  let bidSlotsUsed = 0;
  for (const quote of rankedQuotes) {
    if (slotsUsed >= slots) break;
    if (quote.side === "bid" && bidSlotsUsed >= bidSlotLimit) {
      actions.push({ kind: "skip", message: `${quote.title} ${quote.outcome} bid skipped; remaining slot(s) reserved for inventory exits` });
      continue;
    }
    const aggregateRewardContracts = selectedRewardContractsByMarket.get(quote.marketAppId) ?? 0;
    if (quote.source === "reward" && quote.rewardMinContracts !== undefined && aggregateRewardContracts < quote.rewardMinContracts) {
      actions.push({
        kind: "skip",
        message: `${quote.title} aggregate reward contracts ${aggregateRewardContracts.toFixed(6)} below minimum ${quote.rewardMinContracts.toFixed(6)}`,
      });
      continue;
    }
    const risk = checkQuoteRisk(quote, state, config, mode);
    if (!risk.allowed) {
      actions.push({ kind: "skip", message: `${quote.title} ${quote.outcome} ${quote.side}: ${risk.reason}` });
      continue;
    }
    if (mode === "live-dry-run") {
      actions.push({
        kind: "place",
        message: `Would place ${quote.source} ${quote.title} ${quote.outcome} ${quote.side} ${quote.price.toFixed(3)} size $${quote.notionalUsd.toFixed(
          2,
        )} / ${quote.sizeShares.toFixed(6)} shares; ${quote.reason}`,
      });
      slotsUsed += 1;
      if (quote.side === "bid") bidSlotsUsed += 1;
      continue;
    }
    if (quote.side === "ask" && quote.source !== "inventory_exit") {
      actions.push({ kind: "skip", message: `${quote.title} ${quote.outcome} ask skipped unless it is an inventory exit` });
      continue;
    }
    try {
      const result = await liveClient.createLimitOrder({
        marketAppId: quote.marketAppId,
        outcome: quote.outcome,
        price: quote.price,
        sizeShares: quote.sizeShares,
        isBuying: quote.side === "bid",
      });
      state.openOrders.push(toTrackedLiveOrder(quote, result));
      state.strategyStats.liveOrdersPlaced += 1;
      slotsUsed += 1;
      if (quote.side === "bid") bidSlotsUsed += 1;
      actions.push({ kind: "place", message: `Placed ${quote.title} ${quote.outcome} ${quote.side} escrowAppId=${result.escrowAppId}` });
      await saveAlphaState(config.stateKey, state);
    } catch (error) {
      actions.push({ kind: "skip", message: `Place failed ${quote.title} ${quote.outcome}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  state.strategyStats.lastRunMode = mode;
  if (mode === "live") await saveAlphaState(config.stateKey, state);
  return { actions, state, walletUsdcBalanceUsd, walletAlgoBalance };
}
