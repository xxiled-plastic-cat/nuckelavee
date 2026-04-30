import type { AlphaConfig } from "./alphaConfig.js";
import type { AlphaBotState } from "./alphaTypes.js";

export function accrueEstimatedRewards(state: AlphaBotState, config: AlphaConfig, now = Date.now()): void {
  const last = Date.parse(state.lastUpdated);
  const elapsedSeconds = Number.isFinite(last) ? Math.max(0, (now - last) / 1000) : 0;
  if (elapsedSeconds <= 0) return;
  const eligibleByMarket = new Map<string, { minContracts: number; restingContracts: number }>();
  for (const order of state.openOrders) {
    if (order.status !== "open" || !order.rewardEligible) continue;
    const ageSeconds = Math.max(0, (now - Date.parse(order.createdAt)) / 1000);
    if (ageSeconds < config.rewardMinDwellSeconds) continue;
    const current = eligibleByMarket.get(order.marketId) ?? {
      minContracts: order.rewardMinContracts ?? 0,
      restingContracts: 0,
    };
    current.minContracts = Math.max(current.minContracts, order.rewardMinContracts ?? 0);
    current.restingContracts += order.remainingShares;
    eligibleByMarket.set(order.marketId, current);
  }

  for (const order of state.openOrders) {
    if (order.status !== "open" || !order.rewardEligible || order.estimatedRewardUsdPerDay === undefined) continue;
    const ageSeconds = Math.max(0, (now - Date.parse(order.createdAt)) / 1000);
    if (ageSeconds < config.rewardMinDwellSeconds) continue;
    const marketEligibility = eligibleByMarket.get(order.marketId);
    if (!marketEligibility || marketEligibility.restingContracts < marketEligibility.minContracts) continue;
    const estimate = order.estimatedRewardUsdPerDay * config.estimatedRewardShare * (elapsedSeconds / 86_400);
    state.estimatedRewardsUsd += estimate;
    state.estimatedRewardsByMarket[order.marketId] = (state.estimatedRewardsByMarket[order.marketId] ?? 0) + estimate;
    state.rewardEligibleSeconds += elapsedSeconds;
  }
}
