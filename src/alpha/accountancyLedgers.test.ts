import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyRewardFlowsToState,
  buildAccountancySnapshot,
  computeCashLedger,
  computeTradingLedger,
} from "./accountancyLedgers.js";
import { emptyAlphaState } from "./alphaStateStore.js";
import { positionKey } from "./inventoryView.js";

describe("accountancy split ledgers", () => {
  it("computes trading PnL from realised + unrealised only", () => {
    const state = emptyAlphaState(100);
    state.realisedPnl = 12;
    state.unrealisedPnl = -3;
    state.totalPnl = 9;
    state.estimatedRewardsUsd = 50;
    state.capitalLedger = {
      lastScanAt: "2026-01-01T00:00:00.000Z",
      rewardsReceivedUsd: 4.5,
      marketUsdcInUsd: 0,
      marketUsdcOutUsd: 0,
      externalInUsd: 0,
      externalOutUsd: 0,
    };
    const trading = computeTradingLedger(state);
    assert.equal(trading.tradingPnlUsd, 9);
    assert.equal(trading.realisedPnlUsd, 12);
    assert.equal(trading.unrealisedPnlUsd, -3);
  });

  it("cash is wallet free + bid escrow (no startingBalance)", () => {
    const cash = computeCashLedger(80, 20);
    assert.equal(cash.cashUsdc, 100);
    assert.equal(cash.walletUsdc, 80);
    assert.equal(cash.bidEscrowUsd, 20);
  });

  it("total economic is trading + rewards received, not blended with seed capital", () => {
    const state = emptyAlphaState(206);
    state.realisedPnl = 10;
    state.unrealisedPnl = 2;
    state.totalPnl = 12;
    state.estimatedRewardsUsd = 99;
    state.capitalLedger = {
      lastScanAt: "2026-01-01T00:00:00.000Z",
      rewardsReceivedUsd: 3,
      marketUsdcInUsd: 0,
      marketUsdcOutUsd: 0,
      externalInUsd: 206,
      externalOutUsd: 0,
    };
    const snapshot = buildAccountancySnapshot({
      state,
      walletUsdc: 150,
      bidEscrowUsd: 25,
      positionsValueUsd: 40,
    });
    assert.equal(snapshot.trading.tradingPnlUsd, 12);
    assert.equal(snapshot.rewards.receivedUsd, 3);
    assert.equal(snapshot.rewards.estimatedAccrualUsd, 99);
    assert.equal(snapshot.cash.cashUsdc, 175);
    assert.equal(snapshot.totalEconomicUsd, 15);
    assert.equal(snapshot.netWorthUsd, 215);
  });

  it("reward flow apply never mutates trading positions or fill history", () => {
    const state = emptyAlphaState(100);
    state.realisedPnl = 7;
    state.unrealisedPnl = 1;
    state.totalPnl = 8;
    state.liveFillEvents = [
      {
        id: "fill-1",
        escrowAppId: 1,
        marketAppId: 1001,
        marketId: "m1",
        outcome: "YES",
        side: "bid",
        shares: 2,
        price: 0.4,
        priceSource: "limit",
        source: "spread",
        filledSharesAfter: 2,
        observedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    state.positionsByMarket[positionKey(1001)] = {
      marketId: "m1",
      marketAppId: 1001,
      title: "Test",
      yesShares: 2,
      noShares: 0,
      avgYesCost: 0.4,
      avgNoCost: 0,
      realisedPnl: 0,
      unrealisedPnl: 0,
    };
    const fillCount = state.liveFillEvents.length;
    const yesShares = state.positionsByMarket[positionKey(1001)]!.yesShares;

    applyRewardFlowsToState(
      state,
      {
        rewardsReceivedUsd: 1.25,
        marketUsdcInUsd: 10,
        marketUsdcOutUsd: 4,
        externalInUsd: 100,
        externalOutUsd: 0,
      },
      { pagesScanned: 2, transfersScanned: 9 },
    );

    assert.equal(state.realisedPnl, 7);
    assert.equal(state.unrealisedPnl, 1);
    assert.equal(state.totalPnl, 8);
    assert.equal(state.liveFillEvents!.length, fillCount);
    assert.equal(state.positionsByMarket[positionKey(1001)]!.yesShares, yesShares);
    assert.equal(state.capitalLedger?.rewardsReceivedUsd, 1.25);
    assert.equal(state.capitalLedger?.pagesScanned, 2);
  });
});
