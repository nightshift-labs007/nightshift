// pnpm backfill:gdelt --from YYYY-MM-DD --to YYYY-MM-DD [--query "..."]
// Backfills headline history from the free GDELT DOC 2.0 API (title, link, time only) for analogs and
// eval replays. Replays also need historical 1-minute price bars for the same nights; GDELT has none.
// GDELT asks for at most one request every five seconds; this script waits between windows.
import { addDays, newId } from "@nightshift-signals/core";
import { eq, headlines, openDb, sources } from "@nightshift-signals/db";
import { cliArgs, requireDate } from "./lib/args";

const DEFAULT_QUERY =
  '(oil OR opec OR tariff OR tariffs OR "export controls" OR "rate cut" OR "rate hike" OR stimulus OR sanctions OR missile OR "drug pricing" OR bitcoin) sourcelang:english';
const WINDOW_HOURS = 6;
const PAUSE_MS = 5500;

const args = cliArgs({ from: { type: "string" }, to: { type: "string" }, query: { type: "string" } });
const from = requireDate(args.from);
const to = requireDate(args.to);
const query = args.query ?? DEFAULT_QUERY;
const { db, close } = await openDb();

const url = "https://api.gdeltproject.org/api/v2/doc/doc";
let [src] = await db.select().from(sources).where(eq(sources.url, url));
if (!src) [src] = await db.insert(sources).values({ id: newId("source"), kind: "gdelt", name: "GDELT (backfill)", url, trustWeight: 0.3, active: false }).returning();

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", "");
const parseSeen = (s: string) => new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`);

let inserted = 0;
for (let t = new Date(`${from}T00:00:00Z`); t < new Date(`${addDays(to, 1)}T00:00:00Z`); t = new Date(t.getTime() + WINDOW_HOURS * 3600_000)) {
  const end = new Date(t.getTime() + WINDOW_HOURS * 3600_000);
  const q = new URLSearchParams({ query, mode: "artlist", format: "json", maxrecords: "250", sort: "datedesc", startdatetime: stamp(t), enddatetime: stamp(end) });
  try {
    const res = await fetch(`${url}?${q}`, { signal: AbortSignal.timeout(20_000) });
    const text = await res.text();
    const articles = (text.startsWith("{") ? (JSON.parse(text) as { articles?: { url: string; title: string; seendate: string }[] }).articles : []) ?? [];
    for (const a of articles) {
      const at = parseSeen(a.seendate);
      const r = await db
        .insert(headlines)
        .values({ id: newId("headline", at.getTime()), sourceId: src!.id, sourceItemId: a.url, url: a.url, title: a.title.slice(0, 500), summary: null, lang: "en", publishedAt: at, receivedAt: at })
        .onConflictDoNothing()
        .returning({ id: headlines.id });
      inserted += r.length;
    }
    console.log(`[gdelt] ${t.toISOString()}: ${articles.length} articles`);
  } catch (e) {
    console.log(`[gdelt] ${t.toISOString()} failed: ${(e as Error).message}`);
  }
  await new Promise((r) => setTimeout(r, PAUSE_MS));
}
console.log(`[gdelt] ${inserted} new headlines. Replays of these nights also need price bars from a market-data vendor.`);
await close();
