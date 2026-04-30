import type { AlphaOrderbook } from "./alphaTypes.js";

export function isTwoSided(book: AlphaOrderbook): boolean {
  return (
    (book.yesBid !== undefined && book.yesAsk !== undefined) ||
    (book.noBid !== undefined && book.noAsk !== undefined)
  );
}

export function getHealthyOrderbooks(books: Iterable<AlphaOrderbook>): AlphaOrderbook[] {
  return [...books].filter((book) => book.source !== "unavailable" && isTwoSided(book));
}
