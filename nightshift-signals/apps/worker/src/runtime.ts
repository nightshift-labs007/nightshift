import {
  CoinbaseBtcSource,
  HashingEmbedder,
  JsonRegistry,
  localSimMarket,
  RedisPriceCache,
  RedisStreamsBus,
  RoutedNews,
  RssSource,
  ScriptedNews,
  ApnsLiveActivitySender,
  ElevenLabsTts,
  ExpoLivePushSender,
  PlatformLiveSender,
  TelegramNotifier,
  WebPushSender,
  UniswapV3Quotes,
  VoyageEmbedder,
  chainClient,
  type Notifier,
  type PriceSource,
} from "@nightshift-signals/adapters";
import { AnthropicJsonModel, OfflineDemoModel } from "@nightshift-signals/ai";
import { SimulatedLedger, ViemLedger } from "@nightshift-signals/chain";
import { etParts, InMemoryBus, lastClose, MARKET_TZ, MemoryPriceCache, type Bus, type PriceCache } from "@nightshift-signals/core";
import { loadTaxonomy } from "@nightshift-signals/core/taxonomy";
import { EMBEDDING_DIM, FairValueService, openDb, type DbHandle } from "@nightshift-signals/db";
import { Cron } from "croner";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import webpush from "web-push";
import { DEFAULT_CONFIG, type Deps } from "./deps";
import type { Env } from "./env";
import { reviewCategories } from "./market/categories";
import { refitBetas, snapshotCloses } from "./market/closes";
import { DriftWatcher } from "./market/drift";
import { pollTokenPrices, TickRecorder } from "./market/prices";
import { syncRegistry } from "./market/registry";
import { makeBriefs } from "./brief";
import { LiveActivityService } from "./live";
import { registerPipeline } from "./pipeline";
import { PushNotifier } from "./push";
import { publishMorningScorecard } from "./scorecard";
import { DEFAULT_SOURCES, DEMO_SOURCE, seedSources } from "./sources";
import { reconcileCommits } from "./stages/commit";
import { gradeDay, LiveExitPricer } from "./stages/grade";
import { pollAllSources } from "./stages/ingest";

export interface Runtime {
  /** Public VAPID key for browsers; null when push is not configured. */
  vapidPublicKey: string | null;
  deps: Deps;
  handle: DbHandle;
  fairValue: FairValueService;
  priceSources: PriceSource[];
  sim: ReturnType<typeof localSimMarket> | null;
  live: LiveActivityService;
}

const DEMO_HEADLINES = [
  "Tanker attacked in Strait of Hormuz as Brent crude jumps 4% in Asian trade",
  "US expands export curbs on advanced AI chips to China, Commerce Department says",
  "Fed's Waller says a December rate cut is not a done deal",
  "China unveils 2 trillion yuan stimulus package to support growth",
  "Local bakery wins national bread award",
  "NATO members agree to raise defense spending target to 3.5% of GDP",
];

/** Builds every dependency from the environment. Local mode simulates the market, chain and news. */
export async function buildRuntime(env: Env, opts: { bus?: Bus; prices?: PriceCache; notifiers?: Notifier[] } = {}): Promise<Runtime> {
  const handle = await openDb(env.DATABASE_URL);
  await handle.migrate();
  const log = (msg: string, extra?: Record<string, unknown>) => console.log(msg, extra ? JSON.stringify(extra) : "");
  const local = env.NIGHTSHIFT_SIGNALS_MODE === "local";
  const sim = local ? localSimMarket() : null;
  const prices = opts.prices ?? (env.REDIS_URL ? new RedisPriceCache(env.REDIS_URL) : new MemoryPriceCache());
  const bus = opts.bus ?? (env.REDIS_URL ? new RedisStreamsBus(env.REDIS_URL) : new InMemoryBus());
  const fairValue = new FairValueService(handle.db, prices);

  let quotes, registry, ledger;
  if (sim) {
    quotes = sim;
    registry = sim;
    ledger = new SimulatedLedger();
  } else {
    const client = chainClient({ rpcUrl: env.ROBINHOOD_CHAIN_RPC_URL!, chainId: env.ROBINHOOD_CHAIN_ID! });
    const uni = { quoterAddress: env.UNISWAP_QUOTER_ADDRESS!, usdgAddress: env.USDG_ADDRESS!, usdgDecimals: env.USDG_DECIMALS };
    quotes = new UniswapV3Quotes(client, uni);
    registry = new JsonRegistry(env.TOKEN_REGISTRY!, client, uni);
    ledger = new ViemLedger({
      rpcUrl: env.ROBINHOOD_CHAIN_RPC_URL!,
      chainId: env.ROBINHOOD_CHAIN_ID!,
      contract: env.LEDGER_CONTRACT_ADDRESS!,
      privateKey: env.COMMITTER_PRIVATE_KEY as `0x${string}`,
    });
  }

  if (!env.VOYAGE_API_KEY) log("[runtime] VOYAGE_API_KEY not set: using the hashing embedder (near-duplicates only)");
  if (!env.ANTHROPIC_API_KEY && local) log("[runtime] ANTHROPIC_API_KEY not set: using the offline keyword stand-in, labeled offline-demo");
  if (!local) log("[runtime] no equities vendor configured: last_close falls back to the token's own 16:00 mid");

  const deps: Deps = {
    db: handle.db,
    bus,
    embedder: env.VOYAGE_API_KEY ? new VoyageEmbedder(env.VOYAGE_API_KEY, EMBEDDING_DIM) : new HashingEmbedder(EMBEDDING_DIM),
    news: new RoutedNews([
      { match: (u) => u.startsWith("scripted:"), source: new ScriptedNews(DEMO_HEADLINES) },
      { match: () => true, source: new RssSource() },
    ]),
    model: env.ANTHROPIC_API_KEY ? new AnthropicJsonModel() : new OfflineDemoModel(loadTaxonomy),
    taxonomy: loadTaxonomy,
    fairValue,
    quotes,
    registry,
    prices,
    equityPrints: null,
    config: {
      ...DEFAULT_CONFIG,
      ...(env.MAX_SLIP_BPS ? { maxSlipBps: env.MAX_SLIP_BPS } : {}),
      ...(env.MIN_POOL_LIQUIDITY_USDG ? { minPoolLiquidityUsdg: env.MIN_POOL_LIQUIDITY_USDG } : {}),
    },
    ledger,
    notifiers: [],
    exits: new LiveExitPricer(quotes),
    tts: env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID ? new ElevenLabsTts(env.ELEVENLABS_API_KEY, env.ELEVENLABS_VOICE_ID) : null,
    appUrl: env.APP_URL,
    now: () => new Date(),
    log,
  };

  const vapid = vapidKeys(env, local);
  deps.notifiers = opts.notifiers ?? [
    ...(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHANNEL_ID ? [new TelegramNotifier(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHANNEL_ID, fetch, env.TELEGRAM_MINIAPP_LINK ?? null)] : []),
    ...(vapid ? [new PushNotifier(handle.db, new WebPushSender({ ...vapid, subject: env.VAPID_SUBJECT }), env.APP_URL)] : []),
  ];

  await seedSources(handle.db, local ? [DEMO_SOURCE] : DEFAULT_SOURCES);
  const apns =
    env.APNS_TEAM_ID && env.APNS_KEY_ID && env.APNS_PRIVATE_KEY && env.APNS_BUNDLE_ID
      ? new ApnsLiveActivitySender({
          teamId: env.APNS_TEAM_ID,
          keyId: env.APNS_KEY_ID,
          privateKey: env.APNS_PRIVATE_KEY.replace(/\\n/g, "\n"),
          bundleId: env.APNS_BUNDLE_ID,
          production: env.APNS_PRODUCTION === "true",
        })
      : null;
  const live = new LiveActivityService(deps, new PlatformLiveSender(apns, new ExpoLivePushSender(env.EXPO_ACCESS_TOKEN ?? null)));
  return { deps, handle, fairValue, priceSources: sim ? [sim] : [new CoinbaseBtcSource()], sim, vapidPublicKey: vapid?.publicKey ?? null, live };
}

/** VAPID keys from env; local mode generates a pair once and keeps it in .data so subscriptions survive restarts. */
function vapidKeys(env: Env, local: boolean): { publicKey: string; privateKey: string } | null {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  if (!local) return null;
  const file = ".data/vapid.json";
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as { publicKey: string; privateKey: string };
  const keys = webpush.generateVAPIDKeys();
  mkdirSync(".data", { recursive: true });
  writeFileSync(file, JSON.stringify(keys));
  return keys;
}

/** Starts the pipeline consumers and every schedule. Market schedules run in America/New_York. */
export function startWorker(rt: Runtime): () => Promise<void> {
  const { deps } = rt;
  registerPipeline(deps);
  rt.live.register();
  const recorder = new TickRecorder(deps);
  const drift = new DriftWatcher(deps, rt.fairValue);
  const stops = rt.priceSources.map((s) => s.start((t) => void recorder.record(t).catch((e) => deps.log("[prices] tick failed", { error: String(e) }))));

  const job = (name: string, fn: () => Promise<unknown>) => async () => {
    try {
      await fn();
    } catch (e) {
      deps.log(`[${name}] failed`, { error: String(e) });
    }
  };
  const ny = { timezone: MARKET_TZ, protect: true };
  const crons = [
    new Cron(rt.sim ? "0 */2 * * * *" : "*/30 * * * * *", { protect: true }, job("ingest", () => pollAllSources(deps))),
    new Cron("0 */15 * * * *", { protect: true }, job("registry", () => syncRegistry(deps))),
    new Cron("*/30 * * * * *", { protect: true }, job("token-prices", () => pollTokenPrices(deps, recorder))),
    new Cron("0 * * * * *", { protect: true }, job("drift", () => drift.check())),
    new Cron("*/15 * * * * *", { protect: true }, job("reconcile", () => reconcileCommits(deps))),
    new Cron("30 0 16 * * 1-5", ny, job("closes", () => snapshotCloses(deps))),
    new Cron(
      "0 45 9 * * 1-5",
      ny,
      job("grade", async () => {
        const summary = await gradeDay(deps, etParts(deps.now()).date);
        deps.log(`[grade] ${summary.graded.length} graded, ${summary.voided.length} void, ${summary.skipped.length} skipped`);
        await publishMorningScorecard(deps, summary);
        await makeBriefs(deps, summary);
        await rt.live.endVoided(summary.voided.map((v) => v.basket_id));
      }),
    ),
    new Cron("0 0 12 * * 0", ny, job("beta", () => refitBetas(deps))),
    new Cron("0 0 13 * * 0", ny, job("categories", () => reviewCategories(deps))),
  ];

  // Prime the registry and prices so the first headline has tokens to map to.
  void job("startup", async () => {
    await syncRegistry(deps);
    await pollTokenPrices(deps, recorder);
    if (rt.sim) {
      // A fresh simulator has no history: record today's prices as the last close so fair value is defined.
      const at = new Date(lastClose(deps.now()).getTime() - 60_000);
      for (const symbol of rt.sim.prices.keys()) {
        await recorder.record({ symbol, px: rt.sim.px(symbol).toFixed(4), src: rt.sim.symbols.includes(symbol) ? "futures" : "dex", ts: at });
      }
      await snapshotCloses(deps);
      await pollTokenPrices(deps, recorder);
      await pollAllSources(deps);
    }
  })();

  return async () => {
    for (const c of crons) c.stop();
    for (const s of stops) s();
    await deps.bus.close();
    await rt.handle.close();
  };
}
