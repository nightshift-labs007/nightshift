import type { BasketAlert, Notifier, PushPayload, PushSender, ScorecardPost } from "@nightshift-signals/adapters";
import { inQuietHours, wantsBasket, type Category } from "@nightshift-signals/core";
import { and, eq, inArray, positions, pushSubscriptions, sql, type Db } from "@nightshift-signals/db";

type Sub = typeof pushSubscriptions.$inferSelect;
const MAX_FAILURES = 5;
const pct = (f: string) => `${Number(f) >= 0 ? "+" : "−"}${Math.abs(Number(f) * 100).toFixed(2)}%`;

/** Web Push. Preferences decide which alerts a subscriber gets; every send for one alert goes out at once. */
export class PushNotifier implements Notifier {
  readonly channel = "push" as const;
  constructor(
    private db: Db,
    private sender: PushSender,
    private appUrl: string,
    private now: () => Date = () => new Date(),
  ) {}

  async publishBasket(a: BasketAlert): Promise<void> {
    const subs = (await this.db.select().from(pushSubscriptions)).filter((s) =>
      wantsBasket({ ...s, categories: s.categories as Category[] }, { severity: a.severity, category: a.category }, this.now()),
    );
    await this.fanOut(subs, (s) => ({ title: a.headline, body: a.thesis_i18n[s.lang] ?? a.thesis, url: a.url, tag: a.basket_id }));
  }

  /** At 9:45 ET: a personal receipt for anyone holding a graded position, the scorecard for everyone else who opted in. */
  async publishScorecard(p: ScorecardPost): Promise<void> {
    const ids = p.graded.map((g) => g.basket_id);
    const held = ids.length
      ? await this.db
          .select({ userId: positions.userId, basketId: positions.basketId, ret: positions.gradedRetPct, vs: positions.gradedVsSpyPct })
          .from(positions)
          .where(and(inArray(positions.basketId, ids), sql`${positions.gradedAt} is not null`))
      : [];
    const subs = (await this.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.receipts, true))).filter((s) => !inQuietHours(this.now(), s));
    const rate = p.hit_rate === null ? "" : ` · ${Math.round(p.hit_rate * 100)}% beat SPY`;
    await this.fanOut(subs, (s) => {
      const mine = held.find((h) => h.userId === s.userId);
      if (mine?.ret && mine.vs) {
        return { title: `Your basket closed ${pct(mine.ret)} at the open`, body: `${pct(mine.vs)} vs SPY, after slippage. Win or lose, here is the receipt.`, url: `${this.appUrl}/b/${mine.basketId}`, tag: `receipt-${p.date}` };
      }
      return { title: `Scorecard ${p.date}${rate}`, body: `${p.graded.length} graded, misses included.`, url: p.url, tag: `scorecard-${p.date}` };
    });
  }

  async publishDrift(d: { symbol: string; gap_bps: number }): Promise<void> {
    const subs = (await this.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.drift, true))).filter((s) => !inQuietHours(this.now(), s));
    const dir = d.gap_bps > 0 ? "above" : "below";
    await this.fanOut(subs, () => ({ title: `${d.symbol} ${Math.abs(d.gap_bps)} bps ${dir} fair value`, body: "Token price vs off-hours fair value. Information, not advice.", url: `${this.appUrl}/radar`, tag: `drift-${d.symbol}` }));
  }

  async publishTrigger(userId: string, t: { nl_text: string; title: string; url: string }): Promise<void> {
    const subs = (await this.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))).filter((s) => !inQuietHours(this.now(), s));
    await this.fanOut(subs, () => ({ title: t.title, body: `Matched your alert: ${t.nl_text}`, url: t.url }));
  }

  private async fanOut(subs: Sub[], payload: (s: Sub) => PushPayload) {
    const results = await Promise.allSettled(subs.map((s) => this.sender.send(s, payload(s))));
    await Promise.all(
      results.map(async (r, i) => {
        const s = subs[i]!;
        if (r.status === "fulfilled" && r.value === "ok") return;
        if ((r.status === "fulfilled" && r.value === "gone") || s.failures + 1 >= MAX_FAILURES) {
          await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        } else {
          await this.db.update(pushSubscriptions).set({ failures: s.failures + 1 }).where(eq(pushSubscriptions.id, s.id));
        }
      }),
    );
  }
}
