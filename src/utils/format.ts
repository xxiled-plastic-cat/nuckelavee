import type { Timeframe } from "../types/market.js";

export function formatPrice(price: number | undefined): string {
  if (price === undefined) return "-";
  return price.toFixed(2);
}

export function formatCents(value: number): string {
  return `${(value * 100).toFixed(2)}c`;
}

export function formatBps(value: number): string {
  return `${value.toFixed(1)} bps`;
}

export function formatTimeframe(timeframe: Timeframe): string {
  return timeframe === "unknown" ? "unknown" : timeframe;
}

export function formatMinutes(mins: number): string {
  if (!Number.isFinite(mins)) return "-";
  if (mins < 0) return `${Math.ceil(mins)}m`;
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = Math.floor(mins % 60);
    return `${h}h ${m}m`;
  }
  return `${Math.floor(mins)}m`;
}

export function padRight(value: string, width: number): string {
  if (value.length >= width) return value;
  return `${value}${" ".repeat(width - value.length)}`;
}
