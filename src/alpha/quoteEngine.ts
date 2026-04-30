import type { AlphaConfig } from "./alphaConfig.js";
import { roundShares } from "./alphaClient.js";
import type { AlphaBotState, AlphaMarket, AlphaOrderbook, AlphaOutcome, AlphaQuote } from "./alphaTypes.js";

function getOutcomeBook(book: AlphaOrderbook, outcome: AlphaOutcome): { bid?: number; ask?: number; mid?: number; spread?: number } {
  return outcome === "YES"
    ? { bid: book.yesBid, ask: book.yesAsk, mid: book.yesMid, spread: book.yesSpread }
    : { bid: book.noBid, ask: book.noAsk, mid: book.noMid, spread: book.noSpread };
}

function quoteSize(price: number, config: AlphaConfig): { sizeShares: number; notionalUsd: number } | undefined {
  if (price <= 0 || price >= 1) return undefined;
  const maxNotional = Math.min(config.targetQuoteSizeUsd, config.maxOrderSizeUsd);
  const sizeShares = roundShares(maxNotional / price);
  if (sizeShares <= 0) return undefined;
  return { sizeShares, notionalUsd: price * sizeShares };
}

function positionShares(state: AlphaBotState, marketId: string, outcome: AlphaOutcome): number {
  const position = state.positionsByMarket[marketId];
  if (!position) return 0;
  return outcome === "YES" ? position.yesShares : position.noShares;
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
    if (midpoint === undefined || midpoint < config.minMidpoint || midpoint > config.maxMidpoint) continue;
    const rewardSpread = market.reward.maxRewardSpreadCents !== undefined ? market.reward.maxRewardSpreadCents / 100 : undefined;
    const rewardBuffer = config.rewardZoneBufferCents / 100;
    const spread = outcomeBook.spread;
    let bid = rewardSpread !== undefined ? midpoint - rewardBuffer : undefined;
    if (bid === undefined && spread !== undefined && outcomeBook.bid !== undefined && outcomeBook.ask !== undefined) {
      bid = midpoint - spread * 0.25;
    }
    if (bid !== undefined && outcomeBook.ask !== undefined && bid >= outcomeBook.ask) {
      bid = outcomeBook.ask - 0.01;
    }
    if (
      bid !== undefined &&
      bid > 0 &&
      (rewardSpread === undefined || Math.abs(midpoint - bid) <= rewardSpread) &&
      (spread === undefined || spread * 100 >= config.minMakerSpreadCents || market.reward.isRewardMarket)
    ) {
      const sized = quoteSize(bid, config);
      if (sized) {
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
          reason: market.reward.isRewardMarket ? "reward-qualified bid near midpoint" : "spread-capture bid",
          rewardEligible: market.reward.isRewardMarket && rewardSpread !== undefined && Math.abs(midpoint - bid) <= rewardSpread,
          rewardZoneDistanceCents: rewardSpread !== undefined ? Math.abs(midpoint - bid) * 100 : undefined,
          estimatedRewardUsdPerDay: market.reward.dailyRewardsUsd,
          source: market.reward.isRewardMarket ? "reward" : "spread",
        });
      }
    }

    const inventory = positionShares(state, market.id, outcome);
    if (inventory <= 0) continue;
    let ask = rewardSpread !== undefined ? midpoint + rewardBuffer : undefined;
    if (ask === undefined && spread !== undefined && outcomeBook.bid !== undefined && outcomeBook.ask !== undefined) {
      ask = midpoint + spread * 0.25;
    }
    if (ask !== undefined && outcomeBook.bid !== undefined && ask <= outcomeBook.bid) {
      ask = outcomeBook.bid + 0.01;
    }
    if (ask !== undefined && ask > 0 && ask < 1) {
      const sized = quoteSize(ask, config);
      if (sized) {
        const sizeShares = Math.min(sized.sizeShares, roundShares(inventory));
        if (sizeShares > 0) {
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
            rewardEligible: market.reward.isRewardMarket && rewardSpread !== undefined && Math.abs(midpoint - ask) <= rewardSpread,
            rewardZoneDistanceCents: rewardSpread !== undefined ? Math.abs(midpoint - ask) * 100 : undefined,
            estimatedRewardUsdPerDay: market.reward.dailyRewardsUsd,
            source: "inventory_exit",
          });
        }
      }
    }
  }
  return quotes;
}
