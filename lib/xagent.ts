import "server-only";
import manifest from "../public/verified/manifest.json";
import { getShiftReports } from "./backtest";
import { getOracleSnapshot, type Quote } from "./oracle";
import { etParts, etToUtcMs } from "./time";
import { postToX, xConfigured, xLength, xPostingOn } from "./x";

/**
 * Nightshift's X agent. It never invents a number: every figure in a post comes from the Oracle, the
 * graded shift report or the verification manifest, and a post is skipped when that data is simulated or missing.
 * No links in posts (X charges much more for them); nightshift.buzz lives in the bio.
 *
 * Slots (New York time). A GitHub workflow calls /api/x/post?slot=… at the matching UTC times for both EDT and
 * EST; a call only posts inside its slot's window, so exactly one of the two fires and nothing needs storing.
 */
export type Slot = "preopen" | "graded" | "weekend" | "fact";
export const SLOTS: Record<Slot, { days: string[]; hour: number; minute: number; what: string }> = {
  preopen: { days: ["Mon", "Tue", "Wed", "Thu", "Fri"], hour: 9, minute: 0, what: "Pre-open call: fair values before the bell" },
  graded: { days: ["Mon", "Tue", "Wed", "Thu", "Fri"], hour: 10, minute: 15, what: "The call graded against the actual open" },
  weekend: { days: ["Sat"], hour: 12, minute: 0, what: "Weekend: Bitcoin trades, the ETF doesn't" },
  fact: { days: ["Wed"], hour: 13, minute: 0, what: "Weekly: proofs, Algorand, Guardian, Cloak, Morpho" },
};
const WINDOW_BEFORE_MIN = 10; // GitHub may start a little early…
const WINDOW_AFTER_MIN = 55; // …or up to most of an hour late; the other DST variant lands an hour away

const money = (x: number) => `$${x.toFixed(2)}`;
const signed = (x: number, d = 2) => `${x >= 0 ? "+" : "-"}${Math.abs(x).toFixed(d)}%`;
const bps = (x: number) => (x < 10 ? x.toFixed(1) : x.toFixed(0));
/** Same day → same wording; different days → different wording. */
const pick = <T,>(options: T[], seed: string) => options[[...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % options.length];
const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function fit(lines: string[]) {
  const out = [...lines];
  // over the limit: drop detail lines from the bottom up, keeping the headline, blank spacers and the closing line
  for (let i = out.length - 2; xLength(out.join("\n")) > 280 && i > 0; i--) if (out[i] !== "") out.splice(i, 1);
  return out.join("\n");
}

type Draft = { slot: Slot; text: string } | { slot: Slot; skip: string };

async function preopen(now: number): Promise<Draft> {
  const snap = await getOracleSnapshot();
  const qs = snap.quotes;
  if (!qs.length || qs.some((q) => q.source !== "live")) return { slot: "preopen", skip: "some prices are simulated right now" };
  const date = etParts(now).date;
  const line = (q: Quote) => `${q.token} ${money(q.fairValue)} (${signed(q.driftPct)}) · conf ${q.confidence}`;
  const head = pick([`Pre-open call · ${dateLabel(date)}`, `Before the bell · ${dateLabel(date)}`, `Nightshift fair values, ${dateLabel(date)} pre-open`], date);
  const tail = pick(
    [
      "Change vs the last close. Graded against the 9:30 open.",
      "Moves vs the last close. We grade this against the open, every day.",
      "vs last close. A stale feed would still show yesterday's price.",
    ],
    date + "t",
  );
  return { slot: "preopen", text: fit([head, "", ...qs.map(line), "", tail]) };
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
      ? `${r.token} called ${money(row.predictedOpen)}, opened ${money(row.actualOpen)}: ${bps(row.nightshiftErrBps)} bps off (stale feed: ${bps(row.staleErrBps)})`
      : `${r.token}: ${bps(row.nightshiftErrBps)} bps off (stale feed: ${bps(row.staleErrBps)})`,
  );
  const spy = today.find((x) => x.r.token === "SPY")?.r ?? today[0].r;
  const record = `Last ${spy.rows.length} opens on ${spy.token}: closer than a stale feed ${spy.wins} times.`;
  const head = pick([`Open graded · ${dateLabel(date)}`, `How the call did · ${dateLabel(date)}`, `Scorecard · ${dateLabel(date)} open`], date);
  return { slot: "graded", text: fit([head, "", ...lines, "", record]) };
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
      `IBIT last close ${money(q.lastClose)}. Fair value now ${money(q.fairValue)} (${signed(q.driftPct)}), confidence ${q.confidence}.`,
      "",
      "A traditional feed will show the Friday close until Monday 9:30. Lending against it shouldn't.",
    ]),
  };
}

function fact(now: number): Draft {
  const M = manifest as { properties: { id: string; plain: string; status: string }[]; algorand: { manifestSha256: string } };
  const proven = M.properties.filter((p) => p.status === "verified").length;
  const rule = (id: string) => M.properties.find((p) => p.id === id)?.plain ?? "";
  const facts = [
    `${proven} of Nightshift's safety rules are machine-checked Lean 4 theorems, proven with Harmonic's Aristotle.\n\nV1: "${rule("V1")}"\n\nThe proof list's fingerprint (${M.algorand.manifestSha256.slice(0, 10)}…) is recorded on Algorand.`,
    "Every pre-open prediction is written to Algorand before the bell.\n\nSo the track record can't be edited afterwards, including by us.",
    `Guardian rule G4: "${rule("G4")}"\n\nProven in Lean, enforced in the Vault contract on Base.`,
    "Cloak: prove a loan is safely backed without revealing its size.\n\nGroth16, 918 constraints, proved in your browser, verified by a contract on Base.",
    "Nightshift's price feed speaks Morpho Blue's format.\n\nTested against a real Morpho market on a fork of Base: it borrows to the limit, refuses one dollar over, and liquidates after a price drop.",
    `Oracle rule O3: "${rule("O3")}"\n\nWhen markets have been shut for days, the Oracle says so, and the Vault lends less.`,
  ];
  const week = Math.floor(now / (7 * 86_400_000));
  return { slot: "fact", text: fit([facts[week % facts.length]]) };
}

export async function draft(slot: Slot, now = Date.now()): Promise<Draft> {
  if (slot === "preopen") return preopen(now);
  if (slot === "graded") return graded(now);
  if (slot === "weekend") return weekend(now);
  return fact(now);
}

export function inWindow(slot: Slot, now = Date.now()) {
  const p = etParts(now);
  const s = SLOTS[slot];
  if (!s.days.includes(p.weekday)) return false;
  const target = etToUtcMs(p.date, s.hour, s.minute);
  return now >= target - WINDOW_BEFORE_MIN * 60_000 && now <= target + WINDOW_AFTER_MIN * 60_000;
}

// a warm server instance won't post the same slot twice in a day even if the scheduler double-fires
const posted = new Set<string>();

export async function runSlot(slot: Slot, opts: { force?: boolean; dryRun?: boolean } = {}) {
  const now = Date.now();
  const key = `${slot}:${etParts(now).date}`;
  if (!opts.force && !opts.dryRun && !inWindow(slot, now)) return { slot, status: "outside window" };
  if (!opts.force && posted.has(key)) return { slot, status: "already posted" };
  const d = await draft(slot, now);
  if ("skip" in d) return { slot, status: "skipped", reason: d.skip };
  if (opts.dryRun || !xConfigured() || !xPostingOn()) return { slot, status: opts.dryRun ? "dry run" : !xConfigured() ? "X keys not configured" : "posting is off (X_POSTING=off)", text: d.text };
  const r = await postToX(d.text);
  posted.add(key);
  return { slot, status: "posted", url: r.url, text: d.text };
}
