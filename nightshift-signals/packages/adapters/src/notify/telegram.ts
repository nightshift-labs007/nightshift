import type { BasketAlert, Notifier, ScorecardPost } from "./types";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pct = (fraction: string) => `${Number(fraction) >= 0 ? "+" : "−"}${Math.abs(Number(fraction) * 100).toFixed(2)}%`;

/** Posts to a Telegram channel through the Bot API. */
export class TelegramNotifier implements Notifier {
  readonly channel = "telegram" as const;
  constructor(
    private token: string,
    private chatId: string,
    private fetchImpl: typeof fetch = fetch,
    /** Direct Mini App link, e.g. https://t.me/<bot>/<app>; basket posts get an "Open" button into it. */
    private miniAppLink: string | null = null,
  ) {}

  async publishBasket(a: BasketAlert): Promise<void> {
    const legs = a.legs.map((l) => `${esc(l.ticker)} ${Math.round(l.weight * 100)}%`).join(" · ");
    const proof = a.simulated ? "simulated commit (local)" : a.commit_pending ? `hash ${a.canonical_hash.slice(0, 10)}… (tx pending)` : `committed ${a.canonical_hash.slice(0, 10)}…`;
    await this.send(
      [
        `⚡ <b>${esc(a.headline)}</b>`,
        "",
        esc(a.thesis),
        "",
        `<b>${legs}</b>`,
        `Confidence ${Math.round(a.confidence * 100)}% · graded 9:45 ET vs SPY`,
        proof,
        `<a href="${esc(a.url)}">Basket and trade links</a>`,
        "",
        "<i>Information, not advice.</i>",
      ].join("\n"),
      this.miniAppLink ? { inline_keyboard: [[{ text: "Open in Nightshift Signals", url: `${this.miniAppLink}?startapp=${a.basket_id}` }]] } : undefined,
    );
  }

  async publishScorecard(p: ScorecardPost): Promise<void> {
    const lines = p.graded.map((g) => `${g.hit ? "✅" : "❌"} ${pct(g.vs_spy_pct)} vs SPY · ${esc(g.thesis.slice(0, 80))}`);
    const voids = p.voids.map((v) => `⚪ void (${esc(v.reason)}) · ${esc(v.basket_id)}`);
    const rate = p.hit_rate === null ? "" : ` · hit rate ${Math.round(p.hit_rate * 100)}%`;
    await this.send([`📊 <b>Scorecard ${p.date}</b>${rate}`, "", ...lines, ...voids, "", `<a href="${esc(p.url)}">Full scorecard, misses included</a>`].join("\n"));
  }

  private async send(text: string, replyMarkup?: object) {
    const res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: this.chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: false }, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`telegram: HTTP ${res.status} ${await res.text()}`);
  }
}
