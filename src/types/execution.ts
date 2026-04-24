import type { LiquiditySignal, Timeframe } from "./market.js";

export type ExecutionMode = "paper" | "live";

export type ExecutionConfig = {
  executionMode: ExecutionMode;
  enableLiveTrading: boolean;
  algodUrl: string;
  payerMnemonic?: string;
  orderQuantity: number;
  minPriceCents: number;
  maxPriceCents: number;
  maxActiveOrders: number;
  maxUsdcaAtRiskCents: number;
  tickIntervalMs: number;
  moveScoreDeltaPct: number;
  minDwellSeconds: number;
  maxMovesPerHour: number;
  haltBlockMinutes: number;
  statePath: string;
};

export type TopTarget = {
  marketId: number;
  strikeIndex: number;
  strikeCents: number;
  underlying: string;
  timeframe: Timeframe;
  expiryTs: number;
  haltTs: number;
  sourceSignal: LiquiditySignal;
  targetScore: number;
  yesBuyPriceCents: number;
  noBuyPriceCents: number;
  quantity: number;
  reason: string;
};

export type ActiveTargetState = {
  mode: ExecutionMode;
  marketId: number;
  strikeIndex: number;
  strikeCents: number;
  underlying: string;
  timeframe: Timeframe;
  yesBuyPriceCents: number;
  noBuyPriceCents: number;
  targetScore: number;
  orderIds: string[];
  placedAt: string;
  lastSeenAt: string;
};

export type BotState = {
  activeTarget?: ActiveTargetState;
  moveHistory: Array<{
    mode?: ExecutionMode;
    movedAt: string;
    from?: string;
    to: string;
    reason: string;
  }>;
};

export type RequoteDecision =
  | {
      action: "hold";
      reason: string;
      topTarget?: TopTarget;
    }
  | {
      action: "move";
      reason: string;
      topTarget: TopTarget;
    }
  | {
      action: "skip";
      reason: string;
      topTarget?: TopTarget;
    };

export type ExecutionResult = {
  mode: ExecutionMode;
  action: "held" | "moved" | "skipped";
  reason: string;
  activeOrderIds: string[];
};
