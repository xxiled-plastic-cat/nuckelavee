import { eq } from "drizzle-orm";

import { botStates } from "../../drizzle/schema.js";
import { getDatabase } from "../db.js";
import type { AlphaBotState } from "./alphaTypes.js";

const MAX_HISTORY = 500;

export function emptyAlphaState(startingBalance: number): AlphaBotState {
  const now = new Date().toISOString();
  return {
    startingBalance,
    cash: startingBalance,
    openOrders: [],
    positionsByMarket: {},
    realisedPnl: 0,
    unrealisedPnl: 0,
    estimatedRewardsUsd: 0,
    estimatedRewardsByMarket: {},
    spreadStatsByMarket: {},
    parityAttempts: [],
    rewardEligibleSeconds: 0,
    totalPnl: 0,
    fills: [],
    cancelledOrders: [],
    strategyStats: {
      ticks: 0,
      rewardMarketsSeen: 0,
      candidatesSeen: 0,
      quotesPlaced: 0,
      liveOrdersPlaced: 0,
      liveOrdersCancelled: 0,
      spreadEntryFills: 0,
      spreadExitFills: 0,
      spreadRealisedPnl: 0,
      parityTradesExecuted: 0,
      parityGrossPnl: 0,
      parityNetPnlEstimate: 0,
      parityFailedLegs: 0,
    },
    notificationState: {},
    lastUpdated: now,
  };
}

function normalizeAlphaState(parsed: AlphaBotState, startingBalance: number): AlphaBotState {
  return {
    ...emptyAlphaState(startingBalance),
    ...parsed,
    openOrders: Array.isArray(parsed.openOrders) ? parsed.openOrders : [],
    fills: Array.isArray(parsed.fills) ? parsed.fills : [],
    cancelledOrders: Array.isArray(parsed.cancelledOrders) ? parsed.cancelledOrders : [],
    parityAttempts: Array.isArray(parsed.parityAttempts) ? parsed.parityAttempts : [],
    positionsByMarket: parsed.positionsByMarket ?? {},
    estimatedRewardsByMarket: parsed.estimatedRewardsByMarket ?? {},
    spreadStatsByMarket: parsed.spreadStatsByMarket ?? {},
    strategyStats: {
      ...emptyAlphaState(startingBalance).strategyStats,
      ...parsed.strategyStats,
    },
    notificationState: parsed.notificationState ?? {},
  };
}

export async function loadAlphaState(key: string, startingBalance: number): Promise<AlphaBotState> {
  const db = getDatabase();
  const [row] = await db.select().from(botStates).where(eq(botStates.key, key)).limit(1);
  if (!row) return emptyAlphaState(startingBalance);
  return normalizeAlphaState(row.state as AlphaBotState, startingBalance);
}

export async function saveAlphaState(key: string, state: AlphaBotState): Promise<void> {
  const bounded: AlphaBotState = {
    ...state,
    fills: state.fills.slice(-MAX_HISTORY),
    cancelledOrders: state.cancelledOrders.slice(-MAX_HISTORY),
    parityAttempts: state.parityAttempts.slice(-MAX_HISTORY),
    totalPnl: state.realisedPnl + state.unrealisedPnl,
    lastUpdated: new Date().toISOString(),
  };
  const db = getDatabase();
  await db
    .insert(botStates)
    .values({ key, state: bounded })
    .onConflictDoUpdate({
      target: botStates.key,
      set: {
        state: bounded,
        updatedAt: new Date(),
      },
    });
}
