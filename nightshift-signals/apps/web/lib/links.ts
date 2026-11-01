"use client";
import { api } from "./api";

export interface TradeLink {
  token_symbol: string;
  underlying_ticker: string;
  token_address: string;
  usdg: string;
  url: string | null;
}

/** The API builds links and enforces the geofence; a 451 means trade links are unavailable here. */
export function fetchLinks(basketId: string, usdg: number) {
  return api<{ simulated: boolean; links: TradeLink[] }>(`/baskets/${basketId}/links?usdg=${usdg}`);
}

/** Logs the quote at click time as the user's paper entry (signed-in users only). */
export async function logEntry(token: string, basketId: string, size: number, legs: { token_symbol: string; price: string; usdg: string }[]) {
  await api(`/me/positions`, {
    method: "POST",
    token,
    body: JSON.stringify({
      basket_id: basketId,
      size_usdg: size.toFixed(2),
      entries: legs.map((l) => ({ token_symbol: l.token_symbol, quote_price: l.price, quote_size_usdg: l.usdg })),
    }),
  });
}
