// pnpm eval --from YYYY-MM-DD --to YYYY-MM-DD [--offline] [--label name]
// The eval harness: replays every trading day in the range through the current prompts and pools the
// graded baskets into one after-slippage scorecard. Compare runs with `pnpm eval:compare`.
import { addDays, computeScorecard, isTradingDay, type ScoreRow } from "@nightshift-signals/core";
import { MAP_PROMPT_VERSION, TRIAGE_PROMPT_VERSION } from "@nightshift-signals/ai";
import { openDb } from "@nightshift-signals/db";
import { mkdirSync, writeFileSync } from "node:fs";
import { cliArgs, requireDate } from "./lib/args";
import { runReplay } from "./lib/replay";

const args = cliArgs({ from: { type: "string" }, to: { type: "string" }, offline: { type: "boolean", default: false }, label: { type: "string" } });
const from = requireDate(args.from);
const to = requireDate(args.to);
const label = args.label ?? `${TRIAGE_PROMPT_VERSION}+${MAP_PROMPT_VERSION}${args.offline ? "-offline" : ""}`;

const source = await openDb();
const days: { date: string; baskets: number; graded: number; hit_rate: number | null; dead_letters: number }[] = [];
const pooled: ScoreRow[] = [];
for (let d = from; d <= to; d = addDays(d, 1)) {
  if (!isTradingDay(d)) continue;
  const { report, score } = await runReplay(source, d, { offline: args.offline, label, quiet: true });
  pooled.push(...score);
  days.push({ date: d, baskets: report.baskets.length, graded: report.grade.graded.length, hit_rate: report.scorecard.hit_rate, dead_letters: report.dead_letters.length });
  console.log(`[eval] ${d}: ${report.grade.graded.length} graded, hit rate ${report.scorecard.hit_rate ?? "n/a"}`);
}
await source.close();

const summary = { label, from, to, prompt_versions: { triage: TRIAGE_PROMPT_VERSION, map: MAP_PROMPT_VERSION }, scorecard: computeScorecard(pooled), days };
mkdirSync("evals", { recursive: true });
const out = `evals/${from}_${to}-${label}.json`;
writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(`[eval] ${summary.scorecard.graded} graded over ${days.length} days, hit rate ${summary.scorecard.hit_rate ?? "n/a"}, mean alpha ${summary.scorecard.mean_alpha ?? "n/a"} → ${out}`);
