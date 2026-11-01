import {
  BASKET_STATUSES,
  CATEGORIES,
  COMMIT_STATUSES,
  DELIVERY_CHANNELS,
  DIRECTIONS,
  HORIZONS,
  PRICE_SOURCES,
  SOURCE_KINDS,
  USER_TIERS,
  VOID_REASONS,
  VOTES,
  type GradeLeg,
  type PositionEntry,
  type TriggerRule,
} from "@nightshift-signals/core";
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  customType,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

/** Dimension of headline embeddings. Must match the embedding model chosen in session 3. */
export const EMBEDDING_DIM = 1024;

// Money, prices and returns: numeric(38,18), read back as strings. Never floats.
const money = (name: string) => numeric(name, { precision: 38, scale: 18 });
const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => tstz("created_at").notNull().defaultNow();

export const sourceKind = pgEnum("source_kind", SOURCE_KINDS);
export const category = pgEnum("category", CATEGORIES);
export const direction = pgEnum("direction", DIRECTIONS);
export const horizon = pgEnum("horizon", HORIZONS);
export const basketStatus = pgEnum("basket_status", BASKET_STATUSES);
export const voidReason = pgEnum("void_reason", VOID_REASONS);
export const commitStatus = pgEnum("commit_status", COMMIT_STATUSES);
export const deliveryChannel = pgEnum("delivery_channel", DELIVERY_CHANNELS);
export const priceSource = pgEnum("price_source", PRICE_SOURCES);
export const userTier = pgEnum("user_tier", USER_TIERS);
export const vote = pgEnum("vote", VOTES);

export const sources = pgTable("sources", {
  id: text("id").primaryKey(),
  kind: sourceKind("kind").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  trustWeight: real("trust_weight").notNull().default(0.5),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    sourcesN: integer("sources_n").notNull().default(1),
    firstSeenAt: tstz("first_seen_at").notNull(),
    // Triage output; null until the triage stage runs.
    isMarketMoving: boolean("is_market_moving"),
    category: category("category"),
    severity: smallint("severity"),
    regions: text("regions").array().notNull().default(sql`'{}'::text[]`),
    entities: text("entities").array().notNull().default(sql`'{}'::text[]`),
    reason: text("reason"),
    /** Three or more independent sources: severity got a +1 boost. */
    corroborated: boolean("corroborated").notNull().default(false),
    triagedAt: tstz("triaged_at"),
    /** Set atomically by the mapper before calling the model, so an event is mapped at most once. */
    mappedAt: tstz("mapped_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("events_created_severity_idx").on(t.createdAt, t.severity),
    check("events_severity_range", sql`${t.severity} between 0 and 5`),
  ],
);

export const headlines = pgTable(
  "headlines",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    sourceItemId: text("source_item_id").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    lang: text("lang").notNull().default("en"),
    publishedAt: tstz("published_at"),
    receivedAt: tstz("received_at").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }),
    eventId: text("event_id").references(() => events.id),
  },
  (t) => [
    // Idempotent ingest: the same item from the same source lands once.
    uniqueIndex("headlines_source_item_uq").on(t.sourceId, t.sourceItemId),
    index("headlines_received_at_idx").on(t.receivedAt),
    index("headlines_event_idx").on(t.eventId),
    index("headlines_embedding_hnsw").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const baskets = pgTable(
  "baskets",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    thesis: text("thesis").notNull(),
    thesisI18n: jsonb("thesis_i18n").$type<Record<string, string>>().notNull().default({}),
    whyChain: text("why_chain").array().notNull().default(sql`'{}'::text[]`),
    whyChainI18n: jsonb("why_chain_i18n").$type<Record<string, string[]>>().notNull().default({}),
    direction: direction("direction").notNull().default("long"),
    confidence: real("confidence").notNull(),
    confidenceCalibrated: real("confidence_calibrated"),
    horizon: horizon("horizon").notNull().default("next_open"),
    maxSlipBps: integer("max_slip_bps").notNull(),
    modelVersion: text("model_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    analogEventIds: text("analog_event_ids").array().notNull().default(sql`'{}'::text[]`),
    canonicalHash: text("canonical_hash"),
    commitTx: text("commit_tx"),
    status: basketStatus("status").notNull().default("draft"),
    voidReason: voidReason("void_reason"),
    createdAt: tstz("created_at").notNull(),
    publishedAt: tstz("published_at"),
  },
  (t) => [
    index("baskets_status_published_idx").on(t.status, t.publishedAt),
    index("baskets_event_idx").on(t.eventId),
    // At most one live basket per event; voided ones stay for the record.
    uniqueIndex("baskets_one_live_per_event").on(t.eventId).where(sql`${t.status} <> 'void'`),
    check("baskets_thesis_len", sql`char_length(${t.thesis}) <= 240`),
    // Commit before you show, enforced by the database too.
    check(
      "baskets_published_has_hash",
      sql`${t.status} not in ('published', 'graded') or (${t.canonicalHash} is not null and ${t.publishedAt} is not null)`,
    ),
    check("baskets_void_has_reason", sql`(${t.status} = 'void') = (${t.voidReason} is not null)`),
  ],
);

export const basketLegs = pgTable(
  "basket_legs",
  {
    basketId: text("basket_id")
      .notNull()
      .references(() => baskets.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    tokenSymbol: text("token_symbol").notNull(),
    tokenAddress: text("token_address").notNull(),
    underlyingTicker: text("underlying_ticker").notNull(),
    weight: numeric("weight", { precision: 10, scale: 8 }).notNull(),
    entryQuotePrice: money("entry_quote_price").notNull(),
    entryQuoteSizeUsdg: money("entry_quote_size_usdg").notNull(),
    estSlippageBps: integer("est_slippage_bps").notNull(),
    fairValue: money("fair_value").notNull(),
    fvGapBps: integer("fv_gap_bps").notNull(),
  },
  (t) => [
    // PK prefix doubles as the basket_legs(basket_id) index.
    primaryKey({ columns: [t.basketId, t.position] }),
    uniqueIndex("basket_legs_token_uq").on(t.basketId, t.tokenSymbol),
    check("basket_legs_weight_range", sql`${t.weight} > 0 and ${t.weight} <= 0.5`),
  ],
);

export const commits = pgTable("commits", {
  basketId: text("basket_id")
    .primaryKey()
    .references(() => baskets.id),
  hash: text("hash").notNull(),
  txHash: text("tx_hash"),
  chainId: integer("chain_id").notNull(),
  blockNumber: bigint("block_number", { mode: "number" }),
  blockTime: tstz("block_time"),
  status: commitStatus("status").notNull().default("pending"),
  confirmedAt: tstz("confirmed_at"),
  createdAt: createdAt(),
});

export const tokens = pgTable(
  "tokens",
  {
    symbol: text("symbol").primaryKey(),
    address: text("address").notNull(),
    underlyingTicker: text("underlying_ticker").notNull(),
    name: text("name").notNull(),
    decimals: smallint("decimals").notNull(),
    poolAddress: text("pool_address"),
    /** Uniswap fee tier in hundredths of a bip (500, 3000, 10000). */
    poolFee: integer("pool_fee"),
    poolLiquidityUsdg: money("pool_liquidity_usdg"),
    proxy: text("proxy"),
    beta: numeric("beta", { precision: 10, scale: 6 }),
    lastClose: money("last_close"),
    active: boolean("active").notNull().default(true),
    eligible: boolean("eligible").notNull().default(false),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tokens_address_uq").on(t.address), index("tokens_underlying_idx").on(t.underlyingTicker)],
);

export const priceBars1m = pgTable(
  "price_bars_1m",
  {
    symbol: text("symbol").notNull(),
    ts: tstz("ts").notNull(),
    o: money("o").notNull(),
    h: money("h").notNull(),
    l: money("l").notNull(),
    c: money("c").notNull(),
    source: priceSource("source").notNull(),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.ts] })],
);

export const grades = pgTable("grades", {
  // Primary key = the unique grades(basket_id) index: one grade per basket, ever.
  basketId: text("basket_id")
    .primaryKey()
    .references(() => baskets.id),
  gradedAt: tstz("graded_at").notNull(),
  legs: jsonb("legs").$type<GradeLeg[]>().notNull(),
  retPct: numeric("ret_pct", { precision: 20, scale: 10 }).notNull(),
  spyRetPct: numeric("spy_ret_pct", { precision: 20, scale: 10 }).notNull(),
  spyEntry: money("spy_entry").notNull(),
  spyExit: money("spy_exit").notNull(),
  vsSpyPct: numeric("vs_spy_pct", { precision: 20, scale: 10 }).notNull(),
  hit: boolean("hit").notNull(),
});

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    wallet: text("wallet"),
    email: text("email"),
    /** Public name on the paper league. */
    handle: text("handle"),
    /** Telegram user id, for sign-in from the mini-app. */
    telegramId: bigint("telegram_id", { mode: "number" }),
    lang: text("lang").notNull().default("en"),
    country: text("country"),
    tier: userTier("tier").notNull().default("free"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("users_wallet_uq").on(sql`lower(${t.wallet})`),
    uniqueIndex("users_email_uq").on(sql`lower(${t.email})`),
    uniqueIndex("users_handle_uq").on(sql`lower(${t.handle})`),
    uniqueIndex("users_telegram_uq").on(t.telegramId),
    check("users_has_identity", sql`${t.wallet} is not null or ${t.email} is not null or ${t.telegramId} is not null`),
  ],
);

export const triggers = pgTable(
  "triggers",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    nlText: text("nl_text").notNull(),
    compiledRule: jsonb("compiled_rule").$type<TriggerRule>().notNull(),
    channels: deliveryChannel("channels").array().notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("triggers_user_idx").on(t.userId)],
);

export const positions = pgTable(
  "positions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    basketId: text("basket_id")
      .notNull()
      .references(() => baskets.id),
    sizeUsdg: money("size_usdg").notNull(),
    entries: jsonb("entries").$type<PositionEntry[]>().notNull().default([]),
    txHashes: text("tx_hashes").array().notNull().default(sql`'{}'::text[]`),
    /** Filled when the basket is graded: the user's own entries vs the 9:45 ET exits. Paper only. */
    gradedRetPct: numeric("graded_ret_pct", { precision: 20, scale: 10 }),
    gradedVsSpyPct: numeric("graded_vs_spy_pct", { precision: 20, scale: 10 }),
    gradedPnlUsdg: money("graded_pnl_usdg"),
    gradedAt: tstz("graded_at"),
    createdAt: createdAt(),
  },
  (t) => [index("positions_user_idx").on(t.userId), index("positions_basket_idx").on(t.basketId), index("positions_graded_idx").on(t.gradedAt)],
);

/** Append-only. Powers the latency dashboard and proves nobody received a basket early. */
export const deliveries = pgTable(
  "deliveries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    basketId: text("basket_id")
      .notNull()
      .references(() => baskets.id),
    channel: deliveryChannel("channel").notNull(),
    userId: text("user_id").references(() => users.id),
    sentAt: tstz("sent_at").notNull(),
    latencyMs: integer("latency_ms").notNull(),
  },
  (t) => [index("deliveries_basket_sent_idx").on(t.basketId, t.sentAt)],
);

/** Every model call, with the basket or event it served. Feeds debugging and the eval harness. */
export const aiCalls = pgTable(
  "ai_calls",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: text("kind").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    eventId: text("event_id"),
    userPrompt: text("user_prompt").notNull(),
    output: jsonb("output"),
    stopReason: text("stop_reason"),
    error: text("error"),
    latencyMs: integer("latency_ms"),
    usage: jsonb("usage"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_calls_event_idx").on(t.eventId), index("ai_calls_created_idx").on(t.createdAt)],
);

/** Follow or fade: one vote per user per basket, locked 30 minutes after publish. */
export const votes = pgTable(
  "votes",
  {
    basketId: text("basket_id")
      .notNull()
      .references(() => baskets.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    vote: vote("vote").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.basketId, t.userId] })],
);

/** Web Push subscriptions. Anonymous allowed; prefs filter what is sent, never when (all at once). */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    minSeverity: smallint("min_severity").notNull().default(3),
    categories: category("categories").array().notNull().default(sql`'{}'`),
    drift: boolean("drift").notNull().default(false),
    receipts: boolean("receipts").notNull().default(true),
    /** Local hours [start, end) with no pushes; null = none. */
    quietStart: smallint("quiet_start"),
    quietEnd: smallint("quiet_end"),
    tz: text("tz").notNull().default("UTC"),
    lang: text("lang").notNull().default("en"),
    failures: integer("failures").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("push_endpoint_uq").on(t.endpoint), index("push_user_idx").on(t.userId)],
);

/** Categories switched off by the scorecard (four straight losing weeks) or by hand. Read by the mapper. */
export const categoryOverrides = pgTable("category_overrides", {
  category: category("category").primaryKey(),
  disabled: boolean("disabled").notNull(),
  reason: text("reason").notNull(),
  updatedAt: tstz("updated_at").notNull().defaultNow(),
});

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** Morning voice brief, one per trading day per language. Audio is null when no TTS vendor is set (the browser reads it). */
export const briefs = pgTable(
  "briefs",
  {
    date: text("date").notNull(),
    lang: text("lang").notNull(),
    script: text("script").notNull(),
    source: text("source").notNull(),
    audio: bytea("audio"),
    audioMime: text("audio_mime"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.date, t.lang] })],
);

/** Lock-screen tracking of a basket until the open: an iOS Live Activity or an Android ongoing notification. */
export const liveActivities = pgTable(
  "live_activities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    basketId: text("basket_id")
      .notNull()
      .references(() => baskets.id),
    platform: text("platform").$type<"ios" | "android">().notNull(),
    /** iOS: the Live Activity's APNs push token. Android: the device's Expo push token. */
    pushToken: text("push_token").notNull(),
    lastSentAt: tstz("last_sent_at"),
    endedAt: tstz("ended_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("live_activities_token_basket_uq").on(t.pushToken, t.basketId), index("live_activities_basket_idx").on(t.basketId)],
);
