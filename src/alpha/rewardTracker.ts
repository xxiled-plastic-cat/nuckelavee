import type { AlphaConfig } from "./alphaConfig.js";
import type { AlphaBotState } from "./alphaTypes.js";

export function accrueEstimatedRewards(state: AlphaBotState, config: AlphaConfig, now = Date.now()): void {
  const last = Date.parse(state.lastUpdated);
  const elapsedSeconds = Number.isFinite(last) ? Math.max(0, (now - last) / 1000) : 0;
  if (elapsedSeconds <= 0) return;
  for (const order of state.openOrders) {
    if (order.status !== "open" || !order.rewardEligible || order.estimatedRewardUsdPerDay === undefined) continue;
    const estimate = order.estimatedRewardUsdPerDay * config.estimatedRewardShare * (elapsedSeconds / 86_400);
    state.estimatedRewardsUsd += estimate;
    state.estimatedRewardsByMarket[order.marketId] = (state.estimatedRewardsByMarket[order.marketId] ?? 0) + estimate;
    state.rewardEligibleSeconds += elapsedSeconds;
  }
}
