import type { AlphaConfig } from "./alphaConfig.js";
import { roundShares } from "./alphaClient.js";
import type { AlphaBotState, AlphaMarket, AlphaOrderbook, AlphaOutcome, AlphaQuote } from "./alphaTypes.js";

function getOutcomeBook(book: AlphaOrderbook, outcome: AlphaOutcome): { bid?: number; ask?: number; mid?: number; spread?: number } {
  return outcome === "YES"
    ? { bid: book.yesBid, ask: book.yesAsk, mid: book.yesMid, spread: book.yesSpread }
    : { bid: book.noBid, ask: book.noAsk, mid: book.noMid, spread: book.noSpread };
}

function quoteSize(price: number, notionalUsd: number): { sizeShares: number; notionalUsd: number } | undefined {
  if (price <= 0 || price >= 1) return undefined;
  const sizeShares = roundShares(notionalUsd / price);
  if (sizeShares <= 0) return undefined;
  return { sizeShares, notionalUsd: price * sizeShares };
}

function positionShares(state: AlphaBotState, marketId: string, outcome: AlphaOutcome): number {
  const position = state.positionsByMarket[marketId];
  if (!position) return 0;
  return outcome === "YES" ? position.yesShares : position.noShares;
}

function insideSpreadBid(book: { bid?: number; ask?: number; mid?: number; spread?: number }, config: AlphaConfig): number | undefined {
  if (!config.enableSpreadCapture || book.bid === undefined || book.ask === undefined || book.mid === undefined || book.spread === undefined) {
    return undefined;
  }
  if (book.spread * 100 < config.minSpreadCaptureCents) return undefined;
  const edge = Math.min(config.spreadExitEdgeCents / 100, book.spread / 4);
  const bid = Math.min(book.mid - edge, book.ask - 0.000001);
  if (bid <= book.bid || bid >= book.ask) return undefined;
  return bid;
}

function insideSpreadAsk(book: { bid?: number; ask?: number; mid?: number; spread?: number }, config: AlphaConfig): number | undefined {
  if (!config.enableSpreadCapture || book.bid === undefined || book.ask === undefined || book.mid === undefined || book.spread === undefined) {
    return undefined;
  }
  const edge = Math.min(config.spreadExitEdgeCents / 100, book.spread / 4);
  const ask = Math.max(book.mid + edge, book.bid + 0.000001);
  if (ask <= book.bid || ask >= book.ask) return undefined;
  return ask;
}

export function generateQuotes(
  market: AlphaMarket,
  book: AlphaOrderbook,
  state: AlphaBotState,
  config: AlphaConfig,
): AlphaQuote[] {
  const quotes: AlphaQuote[] = [];
  for (const outcome of ["YES", "NO"] as const) {
    const outcomeBook = getOutcomeBook(book, outcome);
    const midpoint = outcomeBook.mid;
    if (midpoint === undefined) continue;
    const rewardSpread = market.reward.maxRewardSpreadCents !== undefined ? market.reward.maxRewardSpreadCents / 100 : undefined;
    const rewardMinContracts = market.reward.isRewardMarket ? market.reward.minContracts : undefined;
    const rewardBuffer = config.rewardZoneBufferCents / 100;
    const spread = outcomeBook.spread;
    const rewardMidpointAllowed = midpoint >= config.minMidpoint && midpoint <= config.maxMidpoint;
    const spreadEntryMidpointAllowed = midpoint >= config.minSpreadEntryMidpoint && midpoint <= config.maxSpreadMidpoint;
    const spreadExitMidpointAllowed = midpoint >= config.minSpreadExitMidpoint && midpoint <= config.maxSpreadMidpoint;
    let bid = market.reward.isRewardMarket && rewardSpread !== undefined && rewardMidpointAllowed ? midpoint - rewardBuffer : undefined;
    if (bid !== undefined && outcomeBook.ask !== undefined && bid >= outcomeBook.ask) {
      bid = outcomeBook.ask - 0.01;
    }
    if (
      bid !== undefined &&
      bid > 0 &&
      (rewardSpread === undefined || Math.abs(midpoint - bid) <= rewardSpread) &&
      (spread === undefined || spread * 100 >= config.minMakerSpreadCents || market.reward.isRewardMarket)
    ) {
      const sized = quoteSize(bid, Math.min(config.targetQuoteSizeUsd, config.maxOrderSizeUsd));
      if (sized) {
        const rewardEligible =
          market.reward.isRewardMarket &&
          rewardSpread !== undefined &&
          Math.abs(midpoint - bid) <= rewardSpread;
        quotes.push({
          id: `${market.marketAppId}:${outcome}:bid:${Date.now()}`,
          marketId: market.id,
          marketAppId: market.marketAppId,
          slug: market.slug,
          title: market.title,
          outcome,
          side: "bid",
          price: bid,
          ...sized,
          reason: rewardEligible ? "reward-zone bid near midpoint; market minimum checked in aggregate" : "spread-capture bid",
          rewardEligible,
          rewardZoneDistanceCents: rewardSpread !== undefined ? Math.abs(midpoint - bid) * 100 : undefined,
          rewardMinContracts,
          estimatedRewardUsdPerDay: market.reward.dailyRewardsUsd,
          source: market.reward.isRewardMarket ? "reward" : "spread",
        });
      }
    }

    const spreadBid = spreadEntryMidpointAllowed ? insideSpreadBid(outcomeBook, config) : undefined;
    if (spreadBid !== undefined) {
      const sized = quoteSize(spreadBid, Math.min(config.spreadOrderSizeUsd, config.maxOrderSizeUsd));
      if (sized) {
        quotes.push({
          id: `${market.marketAppId}:${outcome}:spread-bid:${Date.now()}`,
          marketId: market.id,
          marketAppId: market.marketAppId,
          slug: market.slug,
          title: market.title,
          outcome,
          side: "bid",
          price: spreadBid,
          ...sized,
          reason: `spread-capture bid inside ${((outcomeBook.spread ?? 0) * 100).toFixed(2)}c spread`,
          rewardEligible: false,
          rewardZoneDistanceCents: rewardSpread !== undefined ? Math.abs(midpoint - spreadBid) * 100 : undefined,
          rewardMinContracts,
          estimatedRewardUsdPerDay: market.reward.dailyRewardsUsd,
          source: "spread",
        });
      }
    }

    const inventory = positionShares(state, market.id, outcome);
    if (inventory <= 0) continue;
    let ask =
      market.reward.isRewardMarket && rewardSpread !== undefined && rewardMidpointAllowed
        ? midpoint + rewardBuffer
        : spreadExitMidpointAllowed
          ? insideSpreadAsk(outcomeBook, config)
          : undefined;
    if (ask !== undefined && outcomeBook.bid !== undefined && ask <= outcomeBook.bid) {
      ask = outcomeBook.bid + 0.01;
    }
    if (ask !== undefined && ask > 0 && ask < 1) {
      const sized = quoteSize(ask, Math.min(config.spreadOrderSizeUsd, config.maxOrderSizeUsd));
      if (sized) {
        const sizeShares = Math.min(sized.sizeShares, roundShares(inventory));
        if (sizeShares > 0) {
          const rewardEligible =
            market.reward.isRewardMarket &&
            rewardSpread !== undefined &&
            Math.abs(midpoint - ask) <= rewardSpread;
          quotes.push({
            id: `${market.marketAppId}:${outcome}:ask:${Date.now()}`,
            marketId: market.id,
            marketAppId: market.marketAppId,
            slug: market.slug,
            title: market.title,
            outcome,
            side: "ask",
            price: ask,
            sizeShares,
            notionalUsd: ask * sizeShares,
            reason: "inventory exit ask",
            rewardEligible,
            rewardZoneDistanceCents: rewardSpread !== undefined ? Math.abs(midpoint - ask) * 100 : undefined,
            rewardMinContracts,
            estimatedRewardUsdPerDay: market.reward.dailyRewardsUsd,
            source: "inventory_exit",
          });
        }
      }
    }
  }
  return quotes;
}
