// pnpm replay --date YYYY-MM-DD [--offline] [--label name]
// Replays the overnight session that grades on --date through the current prompts, isolated.
// Run it before going live and on every prompt change; `pnpm eval` runs it over a date range.
import { openDb } from "@nightshift-signals/db";
import { mkdirSync, writeFileSync } from "node:fs";
import { cliArgs, requireDate } from "./lib/args";
import { runReplay } from "./lib/replay";

const args = cliArgs({ date: { type: "string" }, offline: { type: "boolean", default: false }, label: { type: "string" } });
const source = await openDb();
const { report } = await runReplay(source, requireDate(args.date), { offline: args.offline, label: args.label });
mkdirSync("replays", { recursive: true });
const out = `replays/${report.date}-${report.label}.json`;
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`[replay] ${report.baskets.length} baskets, ${report.grade.graded.length} graded, hit rate ${report.scorecard.hit_rate ?? "n/a"} → ${out}`);
await source.close();
