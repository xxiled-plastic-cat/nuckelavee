import type { Timeframe } from "../types/market.js";

export const TAKER_MATCH_FEE_BPS = 99.9;
export const MIN_PRICE = 0.01;
export const MAX_PRICE = 0.99;

export function getHaltWindowMinutes(timeframe: Timeframe): number {
  if (timeframe === "hourly") return 5;
  if (timeframe === "daily") return 30;
  if (timeframe === "weekly") return 60;
  if (timeframe === "monthly") return 90;
  return 5;
}

export function toBps(decimalEdge: number): number {
  return decimalEdge * 10_000;
}

export function normalizePrice(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined || Number.isNaN(value)) return undefined;
  if (value <= 0) return undefined;
  const normalized = value > 1 ? value / 100 : value;
  if (normalized < MIN_PRICE || normalized > MAX_PRICE) return undefined;
  return normalized;
}

export function applyTakerMatchFeeBps(rawEdgeBps: number): number {
  return rawEdgeBps - TAKER_MATCH_FEE_BPS;
}

export function minutesUntil(unixTsSeconds: number, nowSeconds = Date.now() / 1000): number {
  return (unixTsSeconds - nowSeconds) / 60;
}
