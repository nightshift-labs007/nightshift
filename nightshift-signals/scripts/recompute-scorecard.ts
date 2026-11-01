// pnpm recompute --csv scorecard.csv [--api https://host]
// Recomputes every grade in the public scorecard CSV from its stored entry and exit prices,
// and with --api also re-hashes each basket's canonical JSON and checks it against the commit.
// Anyone can run this; it trusts nothing but the CSV, the API's public JSON and the math.
import { gradeBasket, type CsvLeg } from "@nightshift-signals/core";
import { readFileSync } from "node:fs";
import { keccak256, toBytes } from "viem";
import { cliArgs } from "./lib/args";

const args = cliArgs({ csv: { type: "string" }, api: { type: "string" } });
if (!args.csv) throw new Error("usage: --csv path [--api url]");
const text = /^https?:/.test(args.csv) ? await (await fetch(args.csv)).text() : readFileSync(args.csv, "utf8");

const [header, ...lines] = text.trim().split("\n");
const cols = parseLine(header!);
const legs = lines.map((l) => Object.fromEntries(parseLine(l).map((v, i) => [cols[i], v]))) as unknown as Record<keyof CsvLeg, string>[];
const byBasket = Map.groupBy(legs, (l) => l.basket_id);

let mismatches = 0;
for (const [id, ls] of byBasket) {
  const first = ls[0]!;
  if (first.status !== "graded") continue;
  const g = gradeBasket(
    ls.map((l) => ({ token_symbol: l.token_symbol, weight: Number(l.weight), entry_quote_price: l.entry_quote_price, exit_price: l.exit_price, exit_open_print: null })),
    { entry: first.spy_entry, exit: first.spy_exit },
  );
  const ok = g.ret_pct === first.ret_pct && g.vs_spy_pct === first.vs_spy_pct && String(g.hit) === first.hit;
  if (!ok) {
    mismatches++;
    console.log(`MISMATCH ${id}: published ${first.vs_spy_pct}/${first.hit}, recomputed ${g.vs_spy_pct}/${g.hit}`);
  }
  if (args.api) {
    const canonical = await (await fetch(`${args.api}/v1/baskets/${id}/canonical`)).text();
    if (keccak256(toBytes(canonical)) !== first.canonical_hash) {
      mismatches++;
      console.log(`HASH MISMATCH ${id}`);
    }
  }
}
console.log(`${byBasket.size} baskets checked, ${mismatches} mismatches`);
process.exit(mismatches ? 1 : 0);

function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") out.push(cur), (cur = "");
    else cur += c;
  }
  out.push(cur);
  return out;
}
