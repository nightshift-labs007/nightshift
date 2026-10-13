import "server-only";
import manifest from "../public/verified/manifest.json";
import { getShiftReports } from "./backtest";
import { getOracleSnapshot, type Quote } from "./oracle";
import { etParts, etToUtcMs } from "./time";
import { postToX, xConfigured, xLength, xPostingOn } from "./x";
import { CARDS } from "./xtheorems";
import { feature, marketUpdate, movers, news, onchain, trackRecord, type MixCtx } from "./xmix";

/**
 * Nightshift's X agent. It never invents a number: every figure in a post comes from the Oracle, the
 * graded shift report or the verification manifest, and a post is skipped when that data is simulated or missing.
 * No links in posts (X charges much more for them); nightshift.buzz lives in the bio.
 *
 * - hourly: a rotating mix (Q&A on a proven rule, market update, news, stock movers, track record, on-chain status,
 *   product explainers); a type with no data right now hands its hour to the next type
 * - theorem: just the Q&A, for a manual post
 * - preopen / graded / weekend / fact: fixed New York times. The workflow calls each at its UTC time for both EDT
 *   and EST; a call only posts inside the slot's window, so exactly one of the two fires and nothing needs storing.
 */
export type Slot = "hourly" | "theorem" | "preopen" | "graded" | "weekend" | "fact";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
export const SLOTS: Record<Slot, { days: string[]; hour: number; minute: number; what: string; every?: number }> = {
  hourly: { days: [], hour: 0, minute: 0, every: 60, what: "Hourly mix: Q&A, market update, news, movers, track record, on-chain, product" },
  theorem: { days: [], hour: 0, minute: 0, every: 60, what: "A Lean-proven rule as a Q&A, checked on live numbers" },
  preopen: { days: WEEKDAYS, hour: 9, minute: 0, what: "Pre-open call: fair values before the bell" },
  graded: { days: WEEKDAYS, hour: 10, minute: 15, what: "The call graded against the actual open" },
  weekend: { days: ["Sat"], hour: 12, minute: 0, what: "Weekend: Bitcoin trades, the ETF doesn't" },
  fact: { days: ["Wed"], hour: 13, minute: 0, what: "Weekly: Algorand ledger, Cloak, Morpho" },
};
const WINDOW_BEFORE_MIN = 10; // GitHub may start a little early…
const WINDOW_AFTER_MIN = 55; // …or up to most of an hour late; the other DST variant lands an hour away

const money = (x: number) => `$${x.toFixed(2)}`;
/** Same day → same wording; different days → different wording. */
const pick = <T,>(options: T[], seed: string) => options[[...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % options.length];
const etStamp = (now: number) => {
  const p = etParts(now);
  const md = new Date(`${p.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${md}, ${p.hour % 12 || 12}:${String(p.minute).padStart(2, "0")}${p.hour < 12 ? "am" : "pm"} ET`;
};
/** "up 0.26%", "down 0.04%", "flat" */
const move = (pct: number) => (Math.abs(pct) < 0.005 ? "flat" : `${pct > 0 ? "up" : "down"} ${Math.abs(pct).toFixed(2)}%`);
/** basis points → percent, for people */
const pctOff = (bpsVal: number) => `${(bpsVal / 100).toFixed(bpsVal < 10 ? 3 : 2)}%`;

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

/** The n-th Q&A post: proven rules in order, each round on a different live token. */
async function theorem(now: number, n = Math.floor(now / 3_600_000)): Promise<Draft> {
  const verified = new Map(M.properties.filter((p) => p.status === "verified").map((p) => [p.id, p]));
  const cards = CARDS.filter((c) => verified.has(c.id));
  if (!cards.length) return { slot: "theorem", skip: "no verified theorems" };
  const card = cards[n % cards.length];
  const prop = verified.get(card.id)!;
  let live = "";
  if (card.live) {
    const snap = await getOracleSnapshot();
    const quotes = snap.quotes.filter((q) => q.source === "live");
    if (quotes.length) {
      const q = quotes[Math.floor(n / cards.length) % quotes.length]; // a different token each round
      live = card.live({ q, quotes });
    }
  }
  const footer = `✓ Machine-proven (${prop.id}): Lean 4 + Harmonic's Aristotle · ${etStamp(now)}`;
  const build = (formula: string[], withLive: boolean) =>
    [card.ask, "", card.answer, ...(formula.length ? ["", ...formula] : []), ...(withLive && live ? ["", live] : []), "", footer].join("\n");
  // too long? drop extra formula lines first, then the formula, and the live example last: it's the most concrete part
  const tries = [build(card.formula, true), build(card.formula.slice(0, 1), true), build([], true), build(card.formula.slice(0, 1), false)];
  return { slot: "theorem", text: tries.find((t) => xLength(t) <= 275) ?? fit(tries[3].split("\n")) };
}

// one 8-hour cycle, so each type comes round three times a day and the Q&A six times
const MIX = ["qa", "market", "news", "movers", "qa", "track", "onchain", "feature"] as const;
type MixType = (typeof MIX)[number];
const MAKERS: Record<Exclude<MixType, "qa">, (c: MixCtx) => Promise<string[] | null>> = {
  market: marketUpdate,
  news,
  movers,
  track: trackRecord,
  onchain,
  feature,
};

async function hourly(now: number): Promise<Draft> {
  const tick = Math.floor(now / 3_600_000);
  for (let k = 0; k < MIX.length; k++) {
    const t = tick + k;
    const type = MIX[t % MIX.length];
    // how many posts of this type came before: rotates headlines, tokens and explainers independently
    const pos = t % MIX.length;
    const n = Math.floor(t / MIX.length) * MIX.filter((x) => x === type).length + MIX.slice(0, pos).filter((x) => x === type).length;
    if (type === "qa") {
      const d = await theorem(now, n);
      if ("text" in d) return { slot: "hourly", text: d.text };
      continue;
    }
    const lines = await MAKERS[type]({ n, stamp: etStamp(now) }).catch(() => null);
    if (lines) return { slot: "hourly", text: fit(lines) };
  }
  return { slot: "hourly", skip: "no data for any post type right now" };
}

async function preopen(now: number): Promise<Draft> {
  const snap = await getOracleSnapshot();
  const qs = snap.quotes;
  if (!qs.length || qs.some((q) => q.source !== "live")) return { slot: "preopen", skip: "some prices are simulated right now" };
  const date = etParts(now).date;
  const head = pick(
    ["US markets open in 30 minutes. Where should these ETFs open?", "30 minutes to the opening bell. Our call:", "Before the bell: where these ETFs should open today"],
    date,
  );
  const line = (q: Quote) => `${q.token}  ${money(q.fairValue)}  (${move(q.driftPct)})`;
  return { slot: "preopen", text: fit([head, "", ...qs.map(line), "", "vs yesterday's close. We'll grade this at 9:30 ET."]) };
}

async function graded(now: number): Promise<Draft> {
  const date = etParts(now).date;
  const reports = await getShiftReports();
  const today = reports
    .filter((r) => r.source === "live")
    .map((r) => ({ r, row: r.rows.find((x) => x.date === date) }))
    .filter((x): x is { r: (typeof reports)[number]; row: NonNullable<(typeof x)["row"]> } => !!x.row);
  if (!today.length) return { slot: "graded", skip: `no graded open for ${date} yet` };
  const lines = today.map(({ r, row }) => `${r.token}: off by ${pctOff(row.nightshiftErrBps)} (frozen price: ${pctOff(row.staleErrBps)})`);
  const spy = today.find((x) => x.r.token === "SPY")?.r ?? today[0].r;
  const head = pick(["How close was our 9am call to the actual open?", "Scorecard: our pre-open call vs the real open", "Graded: our call vs today's open"], date);
  return {
    slot: "graded",
    text: fit([head, "", ...lines, "", `Last ${spy.rows.length} opens on ${spy.token}: we beat the frozen price ${spy.wins} times.`]),
  };
}

async function weekend(now: number): Promise<Draft> {
  const snap = await getOracleSnapshot();
  const q = snap.quotes.find((x) => x.token === "IBIT");
  if (!q || q.source !== "live") return { slot: "weekend", skip: "IBIT price is simulated right now" };
  const date = etParts(now).date;
  const head = pick(["Stock markets are closed. Bitcoin isn't.", "It's the weekend. Bitcoin is still moving.", "The Bitcoin ETF is closed. Bitcoin isn't."], date);
  return {
    slot: "weekend",
    text: fit([
      head,
      "",
      `The Bitcoin ETF (IBIT) closed Friday at ${money(q.lastClose)}.`,
      `Where it would trade right now: ${money(q.fairValue)} (${move(q.driftPct)}).`,
      "",
      "Most price feeds will show the Friday price until Monday. Nightshift doesn't.",
    ]),
  };
}

function fact(now: number): Draft {
  const facts = [
    "Can Nightshift quietly edit its past predictions?\n\nNo. Every morning's prediction is recorded on the Algorand blockchain before the market opens, so the track record is public and permanent.",
    "Can you prove your loan is safe without showing how big it is?\n\nOn Nightshift, yes. A zero-knowledge proof shows debt < collateral × price × LTV and reveals nothing else. Made in your browser, checked by a contract on Base.",
    "Does Nightshift's price feed work with Morpho, the lending protocol?\n\nYes. We tested it against a real Morpho market on a copy of Base: borrowing up to the limit works, one dollar more is refused, and a price drop triggers liquidation.",
  ];
  const week = Math.floor(now / (7 * 86_400_000));
  return { slot: "fact", text: fit([facts[week % facts.length]]) };
}

export async function draft(slot: Slot, now = Date.now()): Promise<Draft> {
  if (slot === "hourly") return hourly(now);
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
