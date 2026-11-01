// pnpm grade --date YYYY-MM-DD [--post]
// Grades the baskets due at 9:45 ET on --date against DATABASE_URL. Uses live sell quotes when run
// at grade time, otherwise the 1-minute bars recorded at 9:45 ET. Idempotent.
import { etToUtc } from "@nightshift-signals/core";
import { loadEnv } from "@nightshift-signals/worker/env";
import { BarExitPricer, gradeDay } from "@nightshift-signals/worker/grade";
import { buildRuntime } from "@nightshift-signals/worker/runtime";
import { makeBriefs } from "@nightshift-signals/worker/brief";
import { publishMorningScorecard } from "@nightshift-signals/worker/scorecard";
import { cliArgs, requireDate } from "./lib/args";

const args = cliArgs({ date: { type: "string" }, post: { type: "boolean", default: false } });
const date = requireDate(args.date);
const rt = await buildRuntime(loadEnv());
const at = etToUtc(date, 9, 45);
if (Math.abs(Date.now() - at.getTime()) > 10 * 60_000) rt.deps.exits = new BarExitPricer(rt.deps.db);

const summary = await gradeDay(rt.deps, date);
console.log(JSON.stringify(summary, null, 2));
if (args.post) {
  await publishMorningScorecard(rt.deps, summary);
  await makeBriefs(rt.deps, summary);
}
await rt.deps.bus.close();
await rt.handle.close();
