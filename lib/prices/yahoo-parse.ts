// Reading the official close and open out of Yahoo chart responses. Pure (no imports, no network), so the rules can
// be tested on fixed data (test/prices.test.mjs). The caller passes `etDate(epochMs)` → "YYYY-MM-DD" in New York.

export type YahooChart = {
  timestamp?: number[];
  indicators?: { quote?: { open?: (number | null)[]; close?: (number | null)[] }[] };
};

/** Close of the daily bar for `date` (bars are stamped at the session start; nudged 3 h to skip midnight stamps). */
export function dailyClose(daily: YahooChart | null, date: string, etDate: (ms: number) => string): number | null {
  const ts = daily?.timestamp ?? [];
  const closes = daily?.indicators?.quote?.[0]?.close ?? [];
  let out: number | null = null;
  for (let i = 0; i < ts.length; i++) if (etDate(ts[i] * 1000 + 3 * 3600_000) === date && typeof closes[i] === "number") out = closes[i] as number;
  return out && out > 0 ? out : null;
}

/** A field of the intraday bar that starts exactly at `t` (epoch seconds). */
export function barAt(chart: YahooChart | null, t: number, field: "open" | "close"): number | null {
  const i = (chart?.timestamp ?? []).indexOf(t);
  const v = i >= 0 ? chart?.indicators?.quote?.[0]?.[field]?.[i] : null;
  return typeof v === "number" && v > 0 ? v : null;
}

/** Two readings must agree within `tol` (fraction), otherwise neither is trusted. */
export const agree = (a: number | null, b: number | null, tol: number) => a !== null && b !== null && Math.abs(a / b - 1) <= tol;

/**
 * The confirmed close: the daily bar's close for the date, accepted only within 0.5% of the close of the last
 * 5-minute bar of the session (proof the daily bar really is that day's).
 */
export function confirmClose(daily: YahooChart | null, fiveMin: YahooChart | null, date: string, lastBarStart: number, etDate: (ms: number) => string): number | null {
  const close = dailyClose(daily, date, etDate);
  const check = barAt(fiveMin, lastBarStart, "close");
  return agree(close, check, 0.005) ? close : null;
}

/** The confirmed open: the 1-minute and 5-minute bars that start at 09:30:00 ET must agree within 0.3%. */
export function confirmOpen(oneMin: YahooChart | null, fiveMin: YahooChart | null, openStart: number): { open: number; check: number } | null {
  const a = barAt(oneMin, openStart, "open");
  const b = barAt(fiveMin, openStart, "open");
  return agree(a, b, 0.003) ? { open: a!, check: b! } : null;
}
