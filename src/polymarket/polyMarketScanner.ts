import type { PolyConfig } from "./polyConfig.js";
import { PolyClient } from "./polyClient.js";
import type { PolyMarket, PolyOrderbook, PolyScanResult, PolyTokenBookPair } from "./polyTypes.js";

function tokenPairForMarket(market: PolyMarket, orderbooksByTokenId: Map<string, PolyOrderbook>): PolyTokenBookPair {
  const [first, second] = market.tokens;
  return {
    yesToken: first,
    noToken: second,
    yesBook: first ? orderbooksByTokenId.get(first.tokenId) : undefined,
    noBook: second ? orderbooksByTokenId.get(second.tokenId) : undefined,
  };
}

function mergeMarkets(rewardMarkets: PolyMarket[], liveMarkets: PolyMarket[], maxMarkets: number): PolyMarket[] {
  const byCondition = new Map<string, PolyMarket>();
  for (const market of [...rewardMarkets, ...liveMarkets]) {
    const previous = byCondition.get(market.conditionId);
    if (!previous) {
      byCondition.set(market.conditionId, market);
      continue;
    }
    byCondition.set(market.conditionId, {
      ...previous,
      ...market,
      source: "merged",
      reward: {
        ...previous.reward,
        ...market.reward,
        isRewardMarket: previous.reward.isRewardMarket || market.reward.isRewardMarket,
      },
      tokens: market.tokens.length > 0 ? market.tokens : previous.tokens,
      volume24h: market.volume24h ?? previous.volume24h,
      liquidity: market.liquidity ?? previous.liquidity,
      spread: market.spread ?? previous.spread,
    });
  }
  return [...byCondition.values()].slice(0, maxMarkets);
}

export async function loadPolyScan(config: PolyConfig): Promise<PolyScanResult> {
  const client = new PolyClient(config);
  const [rewardMarkets, liveMarkets] = await Promise.all([client.getRewardMarkets(), client.getLiveMarkets()]);
  const markets = mergeMarkets(rewardMarkets, liveMarkets, config.maxMarketsPerScan);
  const rewardConditions = new Set(rewardMarkets.map((market) => market.conditionId));
  const reward = markets.filter((market) => rewardConditions.has(market.conditionId) || market.reward.isRewardMarket);

  const rewardSlice = reward.slice(0, config.rewardOrderbookLimit);
  const spreadSlice = markets.filter((market) => !rewardConditions.has(market.conditionId)).slice(0, config.scanOrderbookLimit);
  const tokenIds = [...rewardSlice, ...spreadSlice].flatMap((market) => market.tokens.map((token) => token.tokenId));
  const orderbooksByTokenId = await client.getOrderbooks(tokenIds);

  const tokenBooksByConditionId = new Map<string, PolyTokenBookPair>();
  for (const market of markets) {
    tokenBooksByConditionId.set(market.conditionId, tokenPairForMarket(market, orderbooksByTokenId));
  }

  return {
    markets,
    rewardMarkets: reward,
    orderbooksByTokenId,
    tokenBooksByConditionId,
  };
}
