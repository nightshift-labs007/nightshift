import { NextResponse, type NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { kvEnabled, kvHLen, kvHSet } from "@/lib/kv";
import { allow } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Per-market waitlists (plan §3, §8). Upstash when connected; a local file in development; off otherwise.
const MARKETS = ["india", "usa", "global"] as const;
type MarketId = (typeof MARKETS)[number];
type Entry = { contact: string; kind: "email" | "telegram"; market: MarketId; at: string };

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
const TELEGRAM = /^@?[a-z][a-z0-9_]{4,31}$/i;
const LOCAL_FILE = path.join(process.cwd(), ".data", "waitlist.json");
const localOk = () => process.env.NODE_ENV !== "production";

async function readLocal(): Promise<Entry[]> {
  return JSON.parse(await fs.readFile(LOCAL_FILE, "utf8").catch(() => "[]")) as Entry[];
}

async function counts(): Promise<Record<MarketId, number> | null> {
  if (kvEnabled()) {
    const n = await Promise.all(MARKETS.map((m) => kvHLen(`waitlist:${m}`).catch(() => 0)));
    return Object.fromEntries(MARKETS.map((m, i) => [m, n[i]])) as Record<MarketId, number>;
  }
  if (!localOk()) return null;
  const all = await readLocal();
  return Object.fromEntries(MARKETS.map((m) => [m, all.filter((e) => e.market === m).length])) as Record<MarketId, number>;
}

export async function GET() {
  const c = await counts();
  return NextResponse.json({ enabled: c !== null, counts: c ?? { india: 0, usa: 0, global: 0 } });
}

export async function POST(req: NextRequest) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (!(await allow(`waitlist:${ip}`, 5, 3600)).ok) return NextResponse.json({ error: "Too many sign-ups from here. Try again in an hour." }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { market?: string; contact?: string } | null;
  const market = MARKETS.find((m) => m === body?.market);
  const raw = String(body?.contact ?? "").trim();
  if (!market) return NextResponse.json({ error: "Pick a market." }, { status: 400 });
  const kind = EMAIL.test(raw) ? "email" : TELEGRAM.test(raw) ? "telegram" : null;
  if (!kind) return NextResponse.json({ error: "Enter an email address or a Telegram @username." }, { status: 400 });
  const contact = kind === "email" ? raw.toLowerCase() : `@${raw.replace(/^@/, "").toLowerCase()}`;
  const entry: Entry = { contact, kind, market, at: new Date().toISOString() };

  if (kvEnabled()) {
    await kvHSet(`waitlist:${market}`, contact, JSON.stringify(entry)); // keyed by contact: signing up twice doesn't double-count
  } else if (localOk()) {
    const all = (await readLocal()).filter((e) => !(e.market === market && e.contact === contact));
    all.push(entry);
    await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
    await fs.writeFile(LOCAL_FILE, JSON.stringify(all, null, 2));
  } else {
    return NextResponse.json({ error: "The waitlist isn't connected yet." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, counts: await counts() });
}
