import { QuoteError, type QuoteSource, type TokenRef } from "@nightshift-signals/adapters";
import { etToUtc, gradeBasket, gradePosition, isTradingDay, makeEvent, nextGradeTime, type VoidReason } from "@nightshift-signals/core";
import { and, basketLegs, baskets, desc, eq, gte, grades, isNull, lte, positions, priceBars1m, tokens, type Db } from "@nightshift-signals/db";
import type { Deps } from "../deps";

export const GRADER = "grader";
const BAR_STALENESS_MS = 30 * 60 * 1000;

export class VoidLeg extends Error {
  constructor(readonly reason: VoidReason) {
    super(reason);
  }
}

/** Exit price per token at grade time, and benchmark prices. */
export interface ExitPricer {
  /** Executable exit: what selling the position bought at the entry quote returns, per token. Throws VoidLeg. */
  tokenExit(token: TokenRef, leg: { entry: string; sizeUsdg: string; slipBps: number }, at: Date): Promise<string>;
}

/** Live grading at 9:45 ET: sell quote for the tokens the reference size bought. */
export class LiveExitPricer implements ExitPricer {
  constructor(private quotes: QuoteSource) {}

  async tokenExit(token: TokenRef, leg: { entry: string; sizeUsdg: string }): Promise<string> {
    const held = (Number(leg.sizeUsdg) / Number(leg.entry)).toFixed(Math.min(token.decimals, 12));
    try {
      const { usdgOut } = await this.quotes.sell(token, held);
      return (Number(usdgOut) / Number(held)).toFixed(12);
    } catch (e) {
      if (e instanceof QuoteError && e.reason === "paused") throw new VoidLeg("pool_paused");
      throw e;
    }
  }
}

/** Replay and backfill: the token's 1-minute bar at grade time, less the leg's estimated slippage. */
export class BarExitPricer implements ExitPricer {
  constructor(private db: Db) {}

  async tokenExit(token: TokenRef, leg: { slipBps: number }, at: Date): Promise<string> {
    const px = await barAt(this.db, token.symbol, at);
    if (!px) throw new Error(`no bar for ${token.symbol} at ${at.toISOString()}`);
    return (Number(px) * (1 - leg.slipBps / 10_000)).toFixed(12);
  }
}

export async function barAt(db: Db, symbol: string, at: Date): Promise<string | null> {
  const [bar] = await db
    .select({ c: priceBars1m.c })
    .from(priceBars1m)
    .where(and(eq(priceBars1m.symbol, symbol), lte(priceBars1m.ts, at), gte(priceBars1m.ts, new Date(at.getTime() - BAR_STALENESS_MS))))
    .orderBy(desc(priceBars1m.ts))
    .limit(1);
  return bar?.c ?? null;
}

export interface GradeSummary {
  date: string;
  graded: string[];
  voided: { basket_id: string; reason: VoidReason }[];
  skipped: { basket_id: string; reason: string }[];
}

/** Grades every next_open basket whose grade time is 9:45 ET on `date`. Idempotent. */
export async function gradeDay(deps: Deps, date: string): Promise<GradeSummary> {
  const summary: GradeSummary = { date, graded: [], voided: [], skipped: [] };
  if (!isTradingDay(date)) return summary;
  const at = etToUtc(date, 9, 45);

  const [spy] = await deps.db.select().from(tokens).where(eq(tokens.underlyingTicker, "SPY")).limit(1);
  const due = (await deps.db.select().from(baskets).where(and(eq(baskets.status, "published"), eq(baskets.horizon, "next_open")))).filter(
    (b) => b.publishedAt && nextGradeTime(b.publishedAt).getTime() === at.getTime(),
  );

  for (const b of due) {
    const legs = await deps.db.select().from(basketLegs).where(eq(basketLegs.basketId, b.id)).orderBy(basketLegs.position);
    try {
      const inputs = [];
      for (const l of legs) {
        const [t] = await deps.db.select().from(tokens).where(eq(tokens.symbol, l.tokenSymbol));
        const ref = { symbol: l.tokenSymbol, address: l.tokenAddress, decimals: t?.decimals ?? 18, poolFee: t?.poolFee ?? null };
        const exit = await deps.exits.tokenExit(ref, { entry: l.entryQuotePrice, sizeUsdg: l.entryQuoteSizeUsdg, slipBps: l.estSlippageBps }, at);
        const open = await deps.equityPrints?.open(l.underlyingTicker, date).catch(() => null);
        inputs.push({ token_symbol: l.tokenSymbol, weight: Number(l.weight), entry_quote_price: l.entryQuotePrice, exit_price: exit, exit_open_print: open ?? null });
      }
      // Leg exits first: a paused pool voids the basket whatever SPY did.
      const spyEntry = spy ? await barAt(deps.db, spy.symbol, b.publishedAt!) : null;
      const spyExit = spy ? await barAt(deps.db, spy.symbol, at) : null;
      if (!spyEntry || !spyExit) {
        summary.skipped.push({ basket_id: b.id, reason: "no SPY price" });
        continue;
      }
      const g = gradeBasket(inputs, { entry: spyEntry, exit: spyExit });
      const gradedAt = deps.now();
      const wrote = await deps.db.transaction(async (tx) => {
        const r = await tx
          .insert(grades)
          .values({ basketId: b.id, gradedAt, legs: g.legs, retPct: g.ret_pct, spyRetPct: g.spy_ret_pct, spyEntry, spyExit, vsSpyPct: g.vs_spy_pct, hit: g.hit })
          .onConflictDoNothing()
          .returning({ id: grades.basketId });
        if (!r.length) return false;
        await tx.update(baskets).set({ status: "graded" }).where(eq(baskets.id, b.id));
        // Paper league: each tracked position is graded on its own logged entry quotes, same exits.
        const exits = new Map(g.legs.map((l) => [l.token_symbol, l.exit_price]));
        for (const p of await tx.select().from(positions).where(and(eq(positions.basketId, b.id), isNull(positions.gradedAt)))) {
          const pg = gradePosition(p.entries, exits, g.spy_ret_pct);
          if (pg) await tx.update(positions).set({ gradedRetPct: pg.ret_pct, gradedVsSpyPct: pg.vs_spy_pct, gradedPnlUsdg: pg.pnl_usdg, gradedAt }).where(eq(positions.id, p.id));
        }
        return true;
      });
      if (!wrote) continue;
      summary.graded.push(b.id);
      await deps.bus.publish(
        makeEvent(
          "basket.graded",
          { basket_id: b.id, ret_pct: g.ret_pct, vs_spy_pct: g.vs_spy_pct, hit: g.hit, graded_at: gradedAt.toISOString() },
          { producer: GRADER, correlation_id: b.eventId, now: gradedAt },
        ),
      );
    } catch (e) {
      if (e instanceof VoidLeg) {
        // Void rules are published in advance: only a halted token or paused pool at the open.
        await deps.db.update(baskets).set({ status: "void", voidReason: e.reason }).where(eq(baskets.id, b.id));
        summary.voided.push({ basket_id: b.id, reason: e.reason });
      } else {
        summary.skipped.push({ basket_id: b.id, reason: String(e) });
      }
    }
  }
  return summary;
}
