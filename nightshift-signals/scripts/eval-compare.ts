// pnpm eval:compare --baseline evals/a.json --candidate evals/b.json [--min 30]
// Ship rule from the deck: a prompt change ships only if its after-slippage hit rate beats the current one.
// Exit 0 = ship, 1 = do not ship, 2 = inconclusive (too few graded baskets, or different date ranges).
import { readFileSync } from "node:fs";
import type { Scorecard } from "@nightshift-signals/core";
import { cliArgs } from "./lib/args";

interface EvalSummary {
  label: string;
  from: string;
  to: string;
  scorecard: Scorecard;
}

const args = cliArgs({ baseline: { type: "string" }, candidate: { type: "string" }, min: { type: "string", default: "30" } });
if (!args.baseline || !args.candidate) throw new Error("usage: --baseline file --candidate file");
const [a, b] = [args.baseline, args.candidate].map((f) => JSON.parse(readFileSync(f!, "utf8")) as EvalSummary);
const min = Number(args.min);
const fmt = (x: number | null, pct = true) => (x === null ? "—" : pct ? `${(x * 100).toFixed(2)}%` : String(x));

console.table({
  [a!.label]: { range: `${a!.from}..${a!.to}`, graded: a!.scorecard.graded, hit_rate: fmt(a!.scorecard.hit_rate), mean_alpha: fmt(a!.scorecard.mean_alpha), voids: a!.scorecard.voids },
  [b!.label]: { range: `${b!.from}..${b!.to}`, graded: b!.scorecard.graded, hit_rate: fmt(b!.scorecard.hit_rate), mean_alpha: fmt(b!.scorecard.mean_alpha), voids: b!.scorecard.voids },
});

if (a!.from !== b!.from || a!.to !== b!.to) {
  console.log("INCONCLUSIVE: the two runs cover different dates.");
  process.exit(2);
}
if (a!.scorecard.graded < min || b!.scorecard.graded < min) {
  console.log(`INCONCLUSIVE: need at least ${min} graded baskets in each run.`);
  process.exit(2);
}
const ship = (b!.scorecard.hit_rate ?? 0) > (a!.scorecard.hit_rate ?? 0);
console.log(ship ? `SHIP: ${b!.label} beats ${a!.label} on after-slippage hit rate.` : `DO NOT SHIP: ${b!.label} does not beat ${a!.label}.`);
process.exit(ship ? 0 : 1);
