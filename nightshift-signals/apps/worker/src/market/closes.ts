import { addDays, etParts, fitBeta, isTradingDay, lastClose, proxyReturn } from "@nightshift-signals/core";
import { and, desc, eq, lt, priceBars1m, tokens } from "@nightshift-signals/db";
import type { Deps } from "../deps";

/**
 * Runs just after 16:00 ET. Stores each token's close for tonight's fair value: the official ETF close
 * when an equities vendor is configured, otherwise the token's own DEX mid at the close (flagged in logs).
 */
export async function snapshotCloses(deps: Deps): Promise<void> {
  const date = etParts(lastClose(deps.now())).date;
  const rows = await deps.db.select().from(tokens).where(eq(tokens.active, true));
  for (const t of rows) {
    const official = await deps.equityPrints?.close(t.underlyingTicker, date).catch(() => null);
    const close = official ?? (await deps.prices.get(t.symbol))?.px ?? null;
    if (!close) continue;
    if (!official) deps.log(`[closes] ${t.symbol}: no official close, using token mid`);
    await deps.db.update(tokens).set({ lastClose: close }).where(eq(tokens.symbol, t.symbol));
  }
}

async function barCloseBefore(deps: Deps, symbol: string, at: Date): Promise<string | null> {
  const [bar] = await deps.db
    .select({ c: priceBars1m.c })
    .from(priceBars1m)
    .where(and(eq(priceBars1m.symbol, symbol), lt(priceBars1m.ts, at)))
    .orderBy(desc(priceBars1m.ts))
    .limit(1);
  return bar?.c ?? null;
}

/**
 * Weekly: regress each token's overnight return (close to next 9:30 ET) on its proxy's return over the same
 * window, across the last 60 trading days. Keeps the existing beta when there are fewer than 20 samples.
 */
export async function refitBetas(deps: Deps, days = 60): Promise<void> {
  const rows = await deps.db.select().from(tokens).where(eq(tokens.active, true));
  const nights: { close: Date; open: Date }[] = [];
  let date = etParts(deps.now()).date;
  while (nights.length < days) {
    date = addDays(date, -1);
    if (!isTradingDay(date)) continue;
    let prev = addDays(date, -1);
    while (!isTradingDay(prev)) prev = addDays(prev, -1);
    nights.push({ close: lastClose(new Date(`${prev}T23:00:00Z`)), open: new Date(`${date}T13:30:00Z`) });
    if (nights.length > 400) break;
  }

  for (const t of rows) {
    if (!t.proxy) continue;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const n of nights) {
      const [tc, to] = [await barCloseBefore(deps, t.symbol, n.close), await barCloseBefore(deps, t.symbol, n.open)];
      const parts = await Promise.all(
        t.proxy.split("+").map(async (p) => ({ close: await barCloseBefore(deps, p, n.close), now: await barCloseBefore(deps, p, n.open) })),
      );
      if (!tc || !to || parts.some((p) => !p.close || !p.now)) continue;
      ys.push(Number(to) / Number(tc) - 1);
      xs.push(Number(proxyReturn(parts as { close: string; now: string }[])));
    }
    const beta = fitBeta(xs, ys);
    if (beta === null) continue;
    await deps.db.update(tokens).set({ beta: beta.toFixed(6) }).where(eq(tokens.symbol, t.symbol));
    deps.log(`[beta] ${t.symbol} = ${beta.toFixed(3)} on ${xs.length} nights`);
  }
}
