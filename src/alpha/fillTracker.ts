import type { AlphaBotState, AlphaOrderbook, AlphaPaperOrder } from "./alphaTypes.js";

function bestOpposingPrice(order: AlphaPaperOrder, book: AlphaOrderbook): number | undefined {
  if (order.outcome === "YES" && order.side === "bid") return book.yesAsk;
  if (order.outcome === "YES" && order.side === "ask") return book.yesBid;
  if (order.outcome === "NO" && order.side === "bid") return book.noAsk;
  return book.noBid;
}

function crossed(order: AlphaPaperOrder, price: number): boolean {
  return order.side === "bid" ? price <= order.price : price >= order.price;
}

function ensurePosition(state: AlphaBotState, order: AlphaPaperOrder) {
  state.positionsByMarket[order.marketId] ??= {
    marketId: order.marketId,
    marketAppId: order.marketAppId,
    slug: order.slug,
    title: order.title,
    yesShares: 0,
    noShares: 0,
    avgYesCost: 0,
    avgNoCost: 0,
    realisedPnl: 0,
    unrealisedPnl: 0,
  };
  return state.positionsByMarket[order.marketId];
}

function applyBidFill(state: AlphaBotState, order: AlphaPaperOrder, shares: number): void {
  const position = ensurePosition(state, order);
  if (order.outcome === "YES") {
    const cost = position.yesShares * position.avgYesCost + shares * order.price;
    position.yesShares += shares;
    position.avgYesCost = position.yesShares > 0 ? cost / position.yesShares : 0;
  } else {
    const cost = position.noShares * position.avgNoCost + shares * order.price;
    position.noShares += shares;
    position.avgNoCost = position.noShares > 0 ? cost / position.noShares : 0;
  }
}

function applyAskFill(state: AlphaBotState, order: AlphaPaperOrder, shares: number): void {
  const position = ensurePosition(state, order);
  const avgCost = order.outcome === "YES" ? position.avgYesCost : position.avgNoCost;
  const pnl = (order.price - avgCost) * shares;
  if (order.outcome === "YES") position.yesShares = Math.max(0, position.yesShares - shares);
  else position.noShares = Math.max(0, position.noShares - shares);
  position.realisedPnl += pnl;
  state.realisedPnl += pnl;
  state.cash += order.price * shares;
}

export function detectPaperFills(state: AlphaBotState, books: Map<number, AlphaOrderbook>): AlphaPaperOrder[] {
  const fills: AlphaPaperOrder[] = [];
  for (const order of state.openOrders) {
    if (order.status !== "open") continue;
    const book = books.get(order.marketAppId);
    if (!book) continue;
    const opposing = bestOpposingPrice(order, book);
    if (opposing === undefined || !crossed(order, opposing)) continue;
    const shares = order.remainingShares;
    if (shares <= 0) continue;
    order.filledShares += shares;
    order.remainingShares = 0;
    order.status = "filled";
    order.updatedAt = new Date().toISOString();
    if (order.side === "bid") applyBidFill(state, order, shares);
    else applyAskFill(state, order, shares);
    fills.push({ ...order });
  }
  if (fills.length > 0) {
    state.fills.push(...fills);
  }
  return fills;
}

export function cancelStalePaperOrders(state: AlphaBotState, staleOrderSeconds = 45): AlphaPaperOrder[] {
  const now = Date.now();
  const cancelled: AlphaPaperOrder[] = [];
  for (const order of state.openOrders) {
    if (order.status !== "open") continue;
    const ageSeconds = (now - Date.parse(order.createdAt)) / 1000;
    if (ageSeconds < staleOrderSeconds) continue;
    order.status = "expired";
    order.updatedAt = new Date().toISOString();
    if (order.side === "bid") {
      state.cash += order.price * order.remainingShares;
    }
    cancelled.push({ ...order });
  }
  state.cancelledOrders.push(...cancelled);
  state.openOrders = state.openOrders.filter((order) => order.status === "open");
  return cancelled;
}
