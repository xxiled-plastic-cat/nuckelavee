import { eq } from "drizzle-orm";

import { botStates } from "../../drizzle/schema.js";
import { getDatabase } from "../db.js";
import type { PolyPaperLane, PolyPaperModelState, PolyPaperState } from "./polyPaperTypes.js";

const MAX_HISTORY = 2_000;

function emptyLaneRecord(): Record<PolyPaperLane, number> {
  return { reward: 0, spread: 0, parity: 0 };
}

function emptyModelState(startingBalance: number): PolyPaperModelState {
  return {
    cash: startingBalance,
    openOrders: [],
    positionsByTokenId: {},
    fills: [],
    cancelledOrders: [],
    metrics: {
      ticks: 0,
      quotesPlaced: 0,
      quotesByLane: emptyLaneRecord(),
      fillsByLane: emptyLaneRecord(),
      expiredByLane: emptyLaneRecord(),
      rewardEligibleSeconds: 0,
      parityAttempts: 0,
      parityFilled: 0,
      parityQuotedEdgeBpsSum: 0,
      parityFilledEdgeBpsSum: 0,
      filledCount: 0,
      fillSeconds: [],
      quoteDistanceBpsSum: 0,
      quoteDistanceSamples: 0,
      realisedPnl: 0,
      unrealisedPnl: 0,
      totalPnl: 0,
    },
  };
}

export function emptyPolyPaperState(startingBalance: number): PolyPaperState {
  return {
    startingBalance,
    conservative: emptyModelState(startingBalance),
    balanced: emptyModelState(startingBalance),
    lastUpdated: new Date().toISOString(),
  };
}

function normalizeModelState(state: PolyPaperModelState, startingBalance: number): PolyPaperModelState {
  const empty = emptyModelState(startingBalance);
  return {
    ...empty,
    ...state,
    openOrders: Array.isArray(state.openOrders) ? state.openOrders : [],
    positionsByTokenId: state.positionsByTokenId ?? {},
    fills: Array.isArray(state.fills) ? state.fills : [],
    cancelledOrders: Array.isArray(state.cancelledOrders) ? state.cancelledOrders : [],
    metrics: {
      ...empty.metrics,
      ...state.metrics,
      quotesByLane: { ...empty.metrics.quotesByLane, ...(state.metrics?.quotesByLane ?? {}) },
      fillsByLane: { ...empty.metrics.fillsByLane, ...(state.metrics?.fillsByLane ?? {}) },
      expiredByLane: { ...empty.metrics.expiredByLane, ...(state.metrics?.expiredByLane ?? {}) },
      fillSeconds: Array.isArray(state.metrics?.fillSeconds) ? state.metrics.fillSeconds : [],
    },
  };
}

function normalizePolyPaperState(parsed: PolyPaperState, startingBalance: number): PolyPaperState {
  const empty = emptyPolyPaperState(startingBalance);
  return {
    ...empty,
    ...parsed,
    conservative: normalizeModelState(parsed.conservative ?? empty.conservative, startingBalance),
    balanced: normalizeModelState(parsed.balanced ?? empty.balanced, startingBalance),
    lastUpdated: parsed.lastUpdated ?? empty.lastUpdated,
  };
}

export async function loadPolyPaperState(key: string, startingBalance: number): Promise<PolyPaperState> {
  const db = getDatabase();
  const [row] = await db.select().from(botStates).where(eq(botStates.key, key)).limit(1);
  if (!row) return emptyPolyPaperState(startingBalance);
  return normalizePolyPaperState(row.state as PolyPaperState, startingBalance);
}

export async function savePolyPaperState(key: string, state: PolyPaperState): Promise<void> {
  const bounded: PolyPaperState = {
    ...state,
    conservative: {
      ...state.conservative,
      fills: state.conservative.fills.slice(-MAX_HISTORY),
      cancelledOrders: state.conservative.cancelledOrders.slice(-MAX_HISTORY),
      metrics: {
        ...state.conservative.metrics,
        fillSeconds: state.conservative.metrics.fillSeconds.slice(-MAX_HISTORY),
        totalPnl: state.conservative.metrics.realisedPnl + state.conservative.metrics.unrealisedPnl,
      },
    },
    balanced: {
      ...state.balanced,
      fills: state.balanced.fills.slice(-MAX_HISTORY),
      cancelledOrders: state.balanced.cancelledOrders.slice(-MAX_HISTORY),
      metrics: {
        ...state.balanced.metrics,
        fillSeconds: state.balanced.metrics.fillSeconds.slice(-MAX_HISTORY),
        totalPnl: state.balanced.metrics.realisedPnl + state.balanced.metrics.unrealisedPnl,
      },
    },
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
