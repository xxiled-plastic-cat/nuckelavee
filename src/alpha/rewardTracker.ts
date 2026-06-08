import type { AlphaConfig } from "./alphaConfig.js";
import type { AlphaBotState } from "./alphaTypes.js";

export function accrueEstimatedRewards(state: AlphaBotState, config: AlphaConfig, now = Date.now()): void {
  const last = Date.parse(state.lastUpdated);
  const elapsedSeconds = Number.isFinite(last) ? Math.max(0, (now - last) / 1000) : 0;
  if (elapsedSeconds <= 0) return;
  const eligibleByMarket = new Map<number, { estimatedRewardUsdPerDay?: number; minContracts: number; restingContracts: number }>();
  for (const order of state.openOrders) {
    if (order.status !== "open" || !order.rewardEligible) continue;
    const ageSeconds = Math.max(0, (now - Date.parse(order.createdAt)) / 1000);
    if (ageSeconds < config.rewardMinDwellSeconds) continue;
    const current = eligibleByMarket.get(order.marketAppId) ?? {
      minContracts: order.rewardMinContracts ?? 0,
      restingContracts: 0,
    };
    current.minContracts = Math.max(current.minContracts, order.rewardMinContracts ?? 0);
    current.restingContracts += order.remainingShares;
    current.estimatedRewardUsdPerDay = Math.max(current.estimatedRewardUsdPerDay ?? 0, order.estimatedRewardUsdPerDay ?? 0);
    eligibleByMarket.set(order.marketAppId, current);
  }

  for (const [marketAppId, marketEligibility] of eligibleByMarket) {
    if (marketEligibility.estimatedRewardUsdPerDay === undefined || marketEligibility.restingContracts < marketEligibility.minContracts) continue;
    const estimate = marketEligibility.estimatedRewardUsdPerDay * config.estimatedRewardShare * (elapsedSeconds / 86_400);
    const marketRewardKey = String(marketAppId);
    state.estimatedRewardsUsd += estimate;
    state.estimatedRewardsByMarket[marketRewardKey] = (state.estimatedRewardsByMarket[marketRewardKey] ?? 0) + estimate;
    state.rewardEligibleSeconds += elapsedSeconds;
  }
}
