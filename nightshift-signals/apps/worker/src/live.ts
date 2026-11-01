import type { LiveActivitySender, LiveState } from "@nightshift-signals/adapters";
import type { Envelope } from "@nightshift-signals/core";
import { and, basketLegs, eq, grades, inArray, isNull, liveActivities } from "@nightshift-signals/db";
import type { Deps } from "./deps";

export const LIVE = "live-activities";
/** Apple budgets Live Activity pushes; one update a minute per activity is plenty for an overnight basket. */
export const LIVE_MIN_INTERVAL_MS = 60_000;
const STALE_AFTER_S = 15 * 60;
const DISMISS_AFTER_S = 4 * 3600;

type Activity = typeof liveActivities.$inferSelect;

/** Keeps lock-screen trackers current overnight and closes them with the graded result at 9:45 ET. */
export class LiveActivityService {
  private legsCache = new Map<string, { symbol: string; ticker: string; weight: number; entry: number }[]>();

  constructor(
    private deps: Deps,
    private sender: LiveActivitySender,
  ) {}

  register() {
    this.deps.bus.subscribe("price.tick", { group: LIVE, maxAttempts: 1 }, (e) => this.onTick(e));
    this.deps.bus.subscribe("basket.graded", { group: LIVE }, (e) => this.onGraded(e));
  }

  async onTick(e: Envelope<"price.tick">): Promise<void> {
    const active = await this.deps.db.select().from(liveActivities).where(isNull(liveActivities.endedAt));
    const now = this.deps.now();
    for (const a of active) {
      const legs = await this.legs(a.basketId);
      if (!legs.some((l) => l.symbol === e.payload.symbol)) continue;
      if (a.lastSentAt && now.getTime() - a.lastSentAt.getTime() < LIVE_MIN_INTERVAL_MS) continue;
      const state = await this.trackingState(a.basketId);
      if (state) await this.send(a, "update", state, { staleAt: state.updatedAt + STALE_AFTER_S });
    }
  }

  async onGraded(e: Envelope<"basket.graded">): Promise<void> {
    const [g] = await this.deps.db.select().from(grades).where(eq(grades.basketId, e.payload.basket_id));
    if (!g) return;
    const legs = await this.legs(e.payload.basket_id);
    const state: LiveState = {
      status: "graded",
      retPct: round(Number(g.retPct) * 100),
      vsSpyPct: round(Number(g.vsSpyPct) * 100),
      legs: legs.map((l) => ({ ticker: l.ticker, chgPct: round(Number(g.legs.find((x) => x.token_symbol === l.symbol)?.ret_pct ?? 0) * 100) })),
      updatedAt: Math.floor(this.deps.now().getTime() / 1000),
    };
    await this.end(e.payload.basket_id, state);
  }

  /** Baskets voided at the open (halted token or paused pool) close their trackers too. */
  async endVoided(basketIds: string[]): Promise<void> {
    for (const id of basketIds) {
      await this.end(id, { status: "void", retPct: 0, vsSpyPct: null, legs: [], updatedAt: Math.floor(this.deps.now().getTime() / 1000) });
    }
  }

  async trackingState(basketId: string): Promise<LiveState | null> {
    const legs = await this.legs(basketId);
    const mids = await this.deps.prices.getMany(legs.map((l) => l.symbol));
    if (legs.some((l) => !mids.has(l.symbol))) return null;
    const chg = legs.map((l) => ({ ticker: l.ticker, chgPct: round((Number(mids.get(l.symbol)!.px) / l.entry - 1) * 100), weight: l.weight }));
    return {
      status: "tracking",
      retPct: round(chg.reduce((s, c) => s + c.weight * c.chgPct, 0)),
      vsSpyPct: null,
      legs: chg.map(({ ticker, chgPct }) => ({ ticker, chgPct })),
      updatedAt: Math.floor(this.deps.now().getTime() / 1000),
    };
  }

  private async end(basketId: string, state: LiveState) {
    const active = await this.deps.db
      .select()
      .from(liveActivities)
      .where(and(eq(liveActivities.basketId, basketId), isNull(liveActivities.endedAt)));
    await Promise.all(active.map((a) => this.send(a, "end", state, { dismissAt: state.updatedAt + DISMISS_AFTER_S }, true)));
  }

  private async send(a: Activity, event: "update" | "end", state: LiveState, opts: { staleAt?: number; dismissAt?: number }, ending = false) {
    const now = this.deps.now();
    try {
      const r = await this.sender.send({ platform: a.platform, pushToken: a.pushToken, basketId: a.basketId }, event, state, opts);
      await this.deps.db
        .update(liveActivities)
        .set({ lastSentAt: now, ...(ending || r === "gone" ? { endedAt: now } : {}) })
        .where(eq(liveActivities.id, a.id));
    } catch (err) {
      this.deps.log(`[live] ${a.platform} ${event} failed for ${a.basketId}`, { error: String(err) });
    }
  }

  private async legs(basketId: string) {
    const hit = this.legsCache.get(basketId);
    if (hit) return hit;
    const rows = await this.deps.db.select().from(basketLegs).where(inArray(basketLegs.basketId, [basketId])).orderBy(basketLegs.position);
    const legs = rows.map((r) => ({ symbol: r.tokenSymbol, ticker: r.underlyingTicker, weight: Number(r.weight), entry: Number(r.entryQuotePrice) }));
    this.legsCache.set(basketId, legs);
    return legs;
  }
}

const round = (v: number) => Math.round(v * 100) / 100;
