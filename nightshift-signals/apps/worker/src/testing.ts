// Test harness: real Postgres engine (PGlite + pgvector), in-memory bus, fake vendors.
import { HashingEmbedder, SimMarket, type BasketAlert, type NewsSource, type Notifier, type RawHeadline, type ScorecardPost } from "@nightshift-signals/adapters";
import { SimulatedLedger } from "@nightshift-signals/chain";
import { FakeJsonModel, MAP_MODEL, type JsonRequest } from "@nightshift-signals/ai";
import { InMemoryBus, MemoryPriceCache } from "@nightshift-signals/core";
import { loadTaxonomy } from "@nightshift-signals/core/taxonomy";
import { EMBEDDING_DIM, openDb, tokens, type FairValueGap } from "@nightshift-signals/db";
import { DEFAULT_CONFIG, type Deps } from "./deps";
import { LiveExitPricer } from "./stages/grade";

export class RecordingNotifier implements Notifier {
  readonly baskets: BasketAlert[] = [];
  readonly scorecards: ScorecardPost[] = [];
  constructor(readonly channel: Notifier["channel"] = "telegram") {}
  async publishBasket(a: BasketAlert) {
    this.baskets.push(a);
  }
  async publishScorecard(p: ScorecardPost) {
    this.scorecards.push(p);
  }
}

export class FakeNews implements NewsSource {
  readonly kind = "fake";
  feeds = new Map<string, RawHeadline[]>();
  async fetch(url: string) {
    return this.feeds.get(url) ?? [];
  }
}

export function rawHeadline(title: string, id = title, summary: string | null = null): RawHeadline {
  return { source_item_id: id, url: `https://example.com/${encodeURIComponent(id)}`, title, summary, lang: "en", published_at: null };
}

/**
 * Scripted Claude: triage scores headlines mentioning "Hormuz" or "export curbs" as severity 4,
 * everything else as noise; mapping returns the first two eligible tickers at 50/50.
 */
export function scriptedModel() {
  return new FakeJsonModel((req: JsonRequest) => {
    if (req.model !== MAP_MODEL) {
      const hot = /hormuz|export curbs/i.test(req.user);
      return {
        is_market_moving: hot,
        category: /hormuz/i.test(req.user) ? "geopolitics_energy" : hot ? "semis_export" : "other",
        regions: [],
        entities: [],
        severity: hot ? 4 : 1,
        reason: "scripted",
      };
    }
    const tickers = (req.schema as { properties: { legs: { items: { properties: { underlying_ticker: { enum: string[] } } } } } })
      .properties.legs.items.properties.underlying_ticker.enum;
    const first = req.user.match(/1\. (.+)/)?.[1] ?? "";
    return {
      skip: false,
      skip_reason: "",
      thesis: "Scripted thesis tying the headline to sector exposure.",
      cited_text: first.split(" ").slice(0, 3).join(" "),
      legs: tickers.slice(0, 2).map((t) => ({ underlying_ticker: t, weight: 0.5 })),
      confidence: 0.6,
    };
  });
}

/** Placeholder tokens for tests and local dev. Addresses are fake; real ones come from the official registry. */
export const TEST_TOKENS = ["XLE", "GLD", "ITA", "SMH", "SPY"].map((symbol, i) => ({
  symbol,
  address: `0x${String(i + 1).repeat(40)}`,
  underlyingTicker: symbol,
  name: `${symbol} Stock Token`,
  decimals: 18,
  poolAddress: `0x${String(i + 5).repeat(40)}`,
  poolFee: 3000,
  poolLiquidityUsdg: "500000",
  proxy: "ES",
  beta: "1.0",
  lastClose: "100",
  active: true,
  eligible: symbol !== "SPY",
}));

export function simMarketFor(rows: typeof TEST_TOKENS) {
  return new SimMarket(
    rows.map((t) => ({
      symbol: t.symbol,
      address: t.address,
      underlying_ticker: t.underlyingTicker,
      name: t.name,
      decimals: t.decimals,
      pool_address: t.poolAddress,
      pool_fee: t.poolFee,
      proxy: t.proxy,
      active: t.active,
      price: Number(t.lastClose),
      liquidity: Number(t.poolLiquidityUsdg),
    })),
  );
}

export async function makeTestDeps(start = new Date("2026-10-21T06:00:00Z")) {
  const handle = await openDb("pglite:memory");
  await handle.migrate();
  const clock = { now: start };
  const bus = new InMemoryBus({ backoffMs: 0 });
  const news = new FakeNews();
  const logs: string[] = [];
  const model = scriptedModel();
  const gaps = new Map<string, FairValueGap>();
  const market = simMarketFor(TEST_TOKENS);
  const telegram = new RecordingNotifier();
  const deps: Deps = {
    db: handle.db,
    bus,
    embedder: new HashingEmbedder(EMBEDDING_DIM),
    news,
    model,
    taxonomy: loadTaxonomy,
    fairValue: { gaps: async () => gaps },
    quotes: market,
    registry: market,
    prices: new MemoryPriceCache(),
    equityPrints: null,
    config: { ...DEFAULT_CONFIG },
    ledger: new SimulatedLedger(),
    notifiers: [telegram],
    exits: new LiveExitPricer(market),
    appUrl: "https://nightshift-signals.test",
    now: () => clock.now,
    log: (m) => logs.push(m),
  };
  return {
    deps,
    bus,
    news,
    logs,
    model,
    gaps,
    market,
    telegram,
    seedTokens: () => handle.db.insert(tokens).values(TEST_TOKENS),
    advance: (ms: number) => (clock.now = new Date(clock.now.getTime() + ms)),
    close: () => handle.close(),
  };
}
