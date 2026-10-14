import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { DEPLOYMENT, isDeployed } from "@/lib/chain";
import type { Quote } from "@/lib/oracle";
import { allow } from "@/lib/ratelimit";

/**
 * Nightshift public API v1: a stable, documented schema (fields are only ever added, never renamed or removed
 * within v1). Responses are cached at the edge for 60 s; uncached requests are limited to 60 per minute per IP.
 */
export const RATE = { max: 60, windowSec: 60 };

export async function v1(req: NextRequest, body: () => Promise<unknown>, cacheSec = 60) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const r = await allow(`v1:${ip}`, RATE.max, RATE.windowSec);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "X-RateLimit-Limit": String(RATE.max),
    "X-RateLimit-Remaining": String(r.remaining),
  };
  if (!r.ok) return NextResponse.json({ error: "rate limited", retryAfterSec: r.resetSec }, { status: 429, headers: { ...headers, "Retry-After": String(r.resetSec) } });
  try {
    return NextResponse.json(await body(), { headers: { ...headers, "Cache-Control": `s-maxage=${cacheSec}, stale-while-revalidate=${cacheSec * 2}` } });
  } catch (e) {
    return NextResponse.json({ error: "upstream data unavailable", detail: String(e).slice(0, 120) }, { status: 503, headers });
  }
}

/** On-chain contracts serving each token's price on Base, for protocols that read the feed directly. */
export function onchain(token: string) {
  const t = isDeployed ? DEPLOYMENT.tokens[token] : undefined;
  if (!t) return null;
  return {
    chainId: DEPLOYMENT.chainId,
    oracle: DEPLOYMENT.contracts.oracle,
    token: t.address,
    chainlinkFeed: t.feed ?? null, // AggregatorV3Interface, 8 decimals
    morphoOracle: t.adapter, // Morpho Blue IOracle, price() at 1e36 scale
  };
}

export function price(q: Quote, updatedAt: string) {
  return {
    token: q.token,
    name: q.name,
    fairValue: q.fairValue,
    confidence: q.confidence,
    lastClose: q.lastClose,
    lastCloseAt: q.lastCloseAt,
    changeVsLastClosePct: q.driftPct,
    marketOpen: q.marketOpen,
    source: q.source, // "live" | "simulated" (never pushed on-chain)
    anchor: { name: q.anchorName, movePct: q.anchorMovePct },
    beta: q.beta ?? null,
    confidenceCaps: q.flags ?? [],
    signals: q.agents.map((a) => ({ id: a.id, estimate: a.estimate, weight: a.weight, detail: a.signal })),
    lltv: q.lltv,
    onchain: onchain(q.token),
    updatedAt,
  };
}
