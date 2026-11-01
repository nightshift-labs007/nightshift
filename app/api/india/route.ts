import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { CONDITIONS, buildDays, nextSessionFeatures, preOpenEstimate, studyConditions } from "@/lib/india/backtest";
import { loadIndiaData } from "@/lib/india/data";

export const dynamic = "force-dynamic";

const NAMES = { nifty: "Nifty 50", sensex: "Sensex", bankNifty: "Bank Nifty", niftyIt: "Nifty IT", vix: "India VIX", usdinr: "USD/INR" } as const;

// Five years of daily bars change once a day, so the whole study is cached for 30 minutes.
const research = unstable_cache(
  async () => {
    const data = await loadIndiaData();
    const days = buildDays(data);
    if (days.length < 200) return null;
    const next = nextSessionFeatures(data);
    const { baseline, studies } = studyConditions(days);
    const active = next ? CONDITIONS.filter((c) => c.test(next.f) === true).map((c) => c.id) : [];
    const board = (Object.keys(NAMES) as (keyof typeof NAMES)[]).flatMap((k) => {
      const b = data[k]?.bars;
      if (!b || b.length < 2) return [];
      const [p, l] = [b[b.length - 2], b[b.length - 1]];
      return [{ key: k, name: NAMES[k], date: l.date, close: l.c, change: l.c / p.c - 1 }];
    });
    return { updatedAt: new Date().toISOString(), board, baseline, studies, active, estimate: preOpenEstimate(days, next), missing: Object.keys({ nifty: 1, spx: 1, crude: 1, gold: 1, usdinr: 1, vix: 1 }).filter((k) => !data[k as keyof typeof data]) };
  },
  ["india-research-v3"],
  { revalidate: 1800 },
);

export async function GET() {
  const r = await research();
  if (!r) return NextResponse.json({ error: "Indian market data is unavailable right now." }, { status: 503 });
  return NextResponse.json(r, { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800" } });
}
