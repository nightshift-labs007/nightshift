import type { Tick } from "@nightshift-signals/adapters";
import { makeEvent, unitPrice } from "@nightshift-signals/core";
import { eq, priceBars1m, sql, tokens } from "@nightshift-signals/db";
import type { Deps } from "../deps";

const BUS_THROTTLE_MS = 1000;

/** Writes a tick to the price cache and its 1-minute bar; publishes price.tick at most once a second per symbol. */
export class TickRecorder {
  private lastPublished = new Map<string, number>();
  constructor(private deps: Deps) {}

  async record(t: Tick): Promise<void> {
    const { deps } = this;
    const ts = t.ts.toISOString();
    // Backfilled or late ticks still write their bar, but never replace a newer cached price.
    const current = await deps.prices.get(t.symbol);
    if (!current || current.ts <= ts) await deps.prices.set(t.symbol, { px: t.px, src: t.src, ts });
    const minute = new Date(Math.floor(t.ts.getTime() / 60_000) * 60_000);
    await deps.db
      .insert(priceBars1m)
      .values({ symbol: t.symbol, ts: minute, o: t.px, h: t.px, l: t.px, c: t.px, source: t.src })
      .onConflictDoUpdate({
        target: [priceBars1m.symbol, priceBars1m.ts],
        set: {
          h: sql`greatest(${priceBars1m.h}, excluded.h)`,
          l: sql`least(${priceBars1m.l}, excluded.l)`,
          c: sql`excluded.c`,
        },
      });
    const last = this.lastPublished.get(t.symbol) ?? 0;
    if (t.ts.getTime() - last < BUS_THROTTLE_MS) return;
    this.lastPublished.set(t.symbol, t.ts.getTime());
    await deps.bus.publish(makeEvent("price.tick", { symbol: t.symbol, px: t.px, src: t.src, ts }, { producer: "prices", correlation_id: t.symbol }));
  }
}

/** Token mids come from a small executable DEX quote (every 30 s). */
export async function pollTokenPrices(deps: Deps, recorder: TickRecorder): Promise<void> {
  const rows = await deps.db.select().from(tokens).where(eq(tokens.active, true));
  await Promise.all(
    rows.map(async (t) => {
      try {
        const q = await deps.quotes.buy({ symbol: t.symbol, address: t.address, decimals: t.decimals, poolFee: t.poolFee }, deps.config.probeSizeUsdg);
        await recorder.record({ symbol: t.symbol, px: unitPrice(deps.config.probeSizeUsdg, q.tokensOut), src: "dex", ts: deps.now() });
      } catch (e) {
        deps.log(`[prices] ${t.symbol} quote failed`, { error: String(e) });
      }
    }),
  );
}
