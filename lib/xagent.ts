import "server-only";
import manifest from "../public/verified/manifest.json";
import { getShiftReports } from "./backtest";
import { getOracleSnapshot, type Quote } from "./oracle";
import { etParts, etToUtcMs } from "./time";
import { postToX, xConfigured, xLength, xPostingOn } from "./x";
import { CARDS } from "./xtheorems";

/**
 * Nightshift's X agent. It never invents a number: every figure in a post comes from the Oracle, the
 * graded shift report or the verification manifest, and a post is skipped when that data is simulated or missing.
 * No links in posts (X charges much more for them); nightshift.buzz lives in the bio.
 *
 * - theorem: every 20 minutes, one of the 24 Lean-proven rules as an equation, evaluated on live numbers
 * - preopen / graded / weekend / fact: fixed New York times. The workflow calls each at its UTC time for both EDT
 *   and EST; a call only posts inside the slot's window, so exactly one of the two fires and nothing needs storing.
 */
export type Slot = "theorem" | "preopen" | "graded" | "weekend" | "fact";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
export const SLOTS: Record<Slot, { days: string[]; hour: number; minute: number; what: string; every?: number }> = {
  theorem: { days: [], hour: 0, minute: 0, every: 20, what: "Every 20 min: a Lean-proven rule as an equation, checked on live numbers" },
  preopen: { days: WEEKDAYS, hour: 9, minute: 0, what: "Pre-open call: fair values before the bell" },
  graded: { days: WEEKDAYS, hour: 10, minute: 15, what: "The call graded against the actual open" },
  weekend: { days: ["Sat"], hour: 12, minute: 0, what: "Weekend: Bitcoin trades, the ETF doesn't" },
  fact: { days: ["Wed"], hour: 13, minute: 0, what: "Weekly: Algorand ledger, Cloak, Morpho" },
};
const WINDOW_BEFORE_MIN = 10; // GitHub may start a little early…
const WINDOW_AFTER_MIN = 55; // …or up to most of an hour late; the other DST variant lands an hour away

const money = (x: number) => `$${x.toFixed(2)}`;
const signed = (x: number, d = 2) => `${x >= 0 ? "+" : "-"}${Math.abs(x).toFixed(d)}%`;
const bps = (x: number) => (x < 10 ? x.toFixed(1) : x.toFixed(0));
/** Same day → same wording; different days → different wording. */
const pick = <T,>(options: T[], seed: string) => options[[...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % options.length];
const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const etStamp = (now: number) => {
  const p = etParts(now);
  return `${dateLabel(p.date)}, ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")} ET`;
};

function fit(lines: string[]) {
  const out = [...lines];
  // over the limit: drop detail lines from the bottom up, keeping the headline, blank spacers and the closing line
  // (275, not 280: a little room in case X counts a symbol differently)
  for (let i = out.length - 2; xLength(out.join("\n")) > 275 && i > 0; i--) if (out[i] !== "") out.splice(i, 1);
  return out.filter((l, i) => !(l === "" && out[i - 1] === "")).join("\n");
}

type Draft = { slot: Slot; text: string } | { slot: Slot; skip: string };
type Manifest = { properties: { id: string; plain: string; status: string }[]; algorand: { manifestSha256: string } };
const M = manifest as Manifest;

/** Every 20 minutes: the next proven theorem (all 24 every 8 hours), evaluated on a rotating live token. */
async function theorem(now: number): Promise<Draft> {
  const verified = new Map(M.properties.filter((p) => p.status === "verified").map((p) => [p.id, p]));
  const cards = CARDS.filter((c) => verified.has(c.id));
  if (!cards.length) return { slot: "theorem", skip: "no verified theorems" };
  const tick = Math.floor(now / (20 * 60_000));
  const card = cards[tick % cards.length];
  const prop = verified.get(card.id)!;
  let live: string[] = [];
  if (card.live) {
    const snap = await getOracleSnapshot();
    const quotes = snap.quotes.filter((q) => q.source === "live");
    if (quotes.length) {
      const q = quotes[Math.floor(tick / cards.length) % quotes.length]; // a different token each 8-hour cycle
      live = card.live({ q, quotes });
    }
  }
  const lines = [
    `Theorem ${card.id} · proven ✓`,
    "",
    ...card.math,
    ...(live.length ? ["", ...live] : []),
    "",
    prop.plain,
    "",
    `Lean 4 · Harmonic Aristotle · ${verified.size}/${M.properties.length} · ${etStamp(now)}`,
  ];
  return { slot: "theorem", text: fit(lines) };
}

async function preopen(now: number): Promise<Draft> {
  const snap = await getOracleSnapshot();
  const qs = snap.quotes;
  if (!qs.length || qs.some((q) => q.source !== "live")) return { slot: "preopen", skip: "some prices are simulated right now" };
  const date = etParts(now).date;
  const line = (q: Quote) => `${q.token}: FV = ${money(q.fairValue)} · Δ ${signed(q.driftPct)} · conf ${q.confidence}`;
  const head = pick([`Pre-open call · ${dateLabel(date)}`, `Before the bell · ${dateLabel(date)}`, `Fair value, ${dateLabel(date)} pre-open`], date);
  const tail = pick(["Δ vs last close. Graded at 9:30: ε = |open − FV|", "Δ vs last close. Scored against the open, every day.", "A stale feed still shows Δ = 0."], date + "t");
  return { slot: "preopen", text: fit([head, "FV = Σ wᵢ·sᵢ  (Σ wᵢ = 1)", "", ...qs.map(line), "", tail]) };
}

async function graded(now: number): Promise<Draft> {
  const date = etParts(now).date;
  const reports = await getShiftReports();
  const today = reports
    .filter((r) => r.source === "live")
    .map((r) => ({ r, row: r.rows.find((x) => x.date === date) }))
    .filter((x): x is { r: (typeof reports)[number]; row: NonNullable<(typeof x)["row"]> } => !!x.row);
  if (!today.length) return { slot: "graded", skip: `no graded open for ${date} yet` };
  // prices for the first token, the rest compact, so all four fit in one post
  const lines = today.map(({ r, row }, i) =>
    i === 0
      ? `${r.token}: FV ${money(row.predictedOpen)} → open ${money(row.actualOpen)} · ε = ${bps(row.nightshiftErrBps)} bps (stale ${bps(row.staleErrBps)})`
      : `${r.token}: ε = ${bps(row.nightshiftErrBps)} bps (stale ${bps(row.staleErrBps)})`,
  );
  const spy = today.find((x) => x.r.token === "SPY")?.r ?? today[0].r;
  const record = `${spy.token}, last ${spy.rows.length} opens: ε_NS < ε_stale ${spy.wins}/${spy.rows.length}`;
  const head = pick([`Open graded · ${dateLabel(date)}`, `How the call did · ${dateLabel(date)}`, `Scorecard · ${dateLabel(date)} open`], date);
  return { slot: "graded", text: fit([head, "ε = |open − FV| / open", "", ...lines, "", record]) };
}

async function weekend(now: number): Promise<Draft> {
  const snap = await getOracleSnapshot();
  const q = snap.quotes.find((x) => x.token === "IBIT");
  if (!q || q.source !== "live") return { slot: "weekend", skip: "IBIT price is simulated right now" };
  const date = etParts(now).date;
  const head = pick(["Markets are closed. Bitcoin isn't.", "Weekend shift.", "The ETF is closed. Its price shouldn't be frozen."], date);
  return {
    slot: "weekend",
    text: fit([
      head,
      "",
      `IBIT: P_close = ${money(q.lastClose)} → FV = ${money(q.fairValue)}`,
      `Δ = ${signed(q.driftPct)} · conf = ${q.confidence}`,
      "",
      "A traditional feed holds P_close until Monday 9:30. Lending against it shouldn't.",
    ]),
  };
}

function fact(now: number): Draft {
  const facts = [
    `Every pre-open call is hashed to Algorand before the bell:\n\nt_commit < 09:30 ET < t_graded\n\nSo the track record can't be edited afterwards, including by us. Proof list fingerprint: ${M.algorand.manifestSha256.slice(0, 10)}…`,
    "Cloak proves\n\ndebt·10⁸ < units·price·LLTV\n\nwithout revealing debt or units.\n\nGroth16 · 918 constraints · proved in your browser · verified by a contract on Base.",
    "price() = P_oracle × 10¹⁸ (Morpho Blue's 1e36 scale)\n\nborrow ≤ C·P·LLTV ✓\nborrow > C·P·LLTV ✗\nP ↓ 20% ⟹ liquidatable ✓\n\nTested against a real Morpho Blue market on a fork of Base.",
  ];
  const week = Math.floor(now / (7 * 86_400_000));
  return { slot: "fact", text: fit([facts[week % facts.length]]) };
}

export async function draft(slot: Slot, now = Date.now()): Promise<Draft> {
  if (slot === "theorem") return theorem(now);
  if (slot === "preopen") return preopen(now);
  if (slot === "graded") return graded(now);
  if (slot === "weekend") return weekend(now);
  return fact(now);
}

export function inWindow(slot: Slot, now = Date.now()) {
  const s = SLOTS[slot];
  if (s.every) return true; // interval slots post on every call; the schedule sets the pace
  const p = etParts(now);
  if (!s.days.includes(p.weekday)) return false;
  const target = etToUtcMs(p.date, s.hour, s.minute);
  return now >= target - WINDOW_BEFORE_MIN * 60_000 && now <= target + WINDOW_AFTER_MIN * 60_000;
}

/** Fixed slots: once a day. Interval slots: once per interval. */
function postKey(slot: Slot, now: number) {
  const every = SLOTS[slot].every;
  return every ? `${slot}:${Math.floor(now / (every * 60_000))}` : `${slot}:${etParts(now).date}`;
}

// a warm server instance won't post the same slot twice even if the scheduler double-fires
const posted = new Set<string>();

export async function runSlot(slot: Slot, opts: { force?: boolean; dryRun?: boolean } = {}) {
  const now = Date.now();
  const key = postKey(slot, now);
  if (!opts.force && !opts.dryRun && !inWindow(slot, now)) return { slot, status: "outside window" };
  if (!opts.force && posted.has(key)) return { slot, status: "already posted" };
  const d = await draft(slot, now);
  if ("skip" in d) return { slot, status: "skipped", reason: d.skip };
  if (opts.dryRun || !xConfigured() || !xPostingOn()) return { slot, status: opts.dryRun ? "dry run" : !xConfigured() ? "X keys not configured" : "posting is off (X_POSTING=off)", text: d.text };
  const r = await postToX(d.text);
  posted.add(key);
  return { slot, status: "posted", url: r.url, text: d.text };
}
