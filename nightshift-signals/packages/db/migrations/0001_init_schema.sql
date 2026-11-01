CREATE TYPE "public"."basket_status" AS ENUM('draft', 'published', 'graded', 'void');--> statement-breakpoint
CREATE TYPE "public"."category" AS ENUM('geopolitics_energy', 'conflict_defense', 'semis_export', 'monetary_policy', 'trade_tariffs', 'china_macro', 'crypto_regulation', 'health_policy', 'earnings_megacap', 'other');--> statement-breakpoint
CREATE TYPE "public"."commit_status" AS ENUM('pending', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."delivery_channel" AS ENUM('ws', 'push', 'telegram', 'x', 'email');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('long', 'short');--> statement-breakpoint
CREATE TYPE "public"."horizon" AS ENUM('next_open', 'next_close', '1w');--> statement-breakpoint
CREATE TYPE "public"."price_source" AS ENUM('dex', 'futures', 'spot', 'chainlink', 'official_open');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('rss', 'x', 'wire', 'gdelt', 'gov');--> statement-breakpoint
CREATE TYPE "public"."user_tier" AS ENUM('free', 'pro');--> statement-breakpoint
CREATE TYPE "public"."void_reason" AS ENUM('illiquid', 'token_halted', 'pool_paused', 'stale');--> statement-breakpoint
CREATE TABLE "basket_legs" (
	"basket_id" text NOT NULL,
	"position" smallint NOT NULL,
	"token_symbol" text NOT NULL,
	"token_address" text NOT NULL,
	"underlying_ticker" text NOT NULL,
	"weight" numeric(10, 8) NOT NULL,
	"entry_quote_price" numeric(38, 18) NOT NULL,
	"entry_quote_size_usdg" numeric(38, 18) NOT NULL,
	"est_slippage_bps" integer NOT NULL,
	"fair_value" numeric(38, 18) NOT NULL,
	"fv_gap_bps" integer NOT NULL,
	CONSTRAINT "basket_legs_basket_id_position_pk" PRIMARY KEY("basket_id","position"),
	CONSTRAINT "basket_legs_weight_range" CHECK ("basket_legs"."weight" > 0 and "basket_legs"."weight" <= 0.5)
);
--> statement-breakpoint
CREATE TABLE "baskets" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"thesis" text NOT NULL,
	"thesis_i18n" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"direction" "direction" DEFAULT 'long' NOT NULL,
	"confidence" real NOT NULL,
	"confidence_calibrated" real,
	"horizon" "horizon" DEFAULT 'next_open' NOT NULL,
	"max_slip_bps" integer NOT NULL,
	"model_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"analog_event_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"canonical_hash" text,
	"commit_tx" text,
	"status" "basket_status" DEFAULT 'draft' NOT NULL,
	"void_reason" "void_reason",
	"created_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "baskets_thesis_len" CHECK (char_length("baskets"."thesis") <= 240),
	CONSTRAINT "baskets_published_has_hash" CHECK ("baskets"."status" not in ('published', 'graded') or ("baskets"."canonical_hash" is not null and "baskets"."published_at" is not null)),
	CONSTRAINT "baskets_void_has_reason" CHECK (("baskets"."status" = 'void') = ("baskets"."void_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "commits" (
	"basket_id" text PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"tx_hash" text,
	"chain_id" integer NOT NULL,
	"block_number" bigint,
	"block_time" timestamp with time zone,
	"status" "commit_status" DEFAULT 'pending' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"basket_id" text NOT NULL,
	"channel" "delivery_channel" NOT NULL,
	"user_id" text,
	"sent_at" timestamp with time zone NOT NULL,
	"latency_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"sources_n" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"is_market_moving" boolean,
	"category" "category",
	"severity" smallint,
	"regions" text[] DEFAULT '{}'::text[] NOT NULL,
	"entities" text[] DEFAULT '{}'::text[] NOT NULL,
	"reason" text,
	"triaged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_severity_range" CHECK ("events"."severity" between 0 and 5)
);
--> statement-breakpoint
CREATE TABLE "grades" (
	"basket_id" text PRIMARY KEY NOT NULL,
	"graded_at" timestamp with time zone NOT NULL,
	"legs" jsonb NOT NULL,
	"ret_pct" numeric(20, 10) NOT NULL,
	"spy_ret_pct" numeric(20, 10) NOT NULL,
	"vs_spy_pct" numeric(20, 10) NOT NULL,
	"hit" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "headlines" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"source_item_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"lang" text DEFAULT 'en' NOT NULL,
	"published_at" timestamp with time zone,
	"received_at" timestamp with time zone NOT NULL,
	"embedding" vector(1024),
	"event_id" text
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"basket_id" text NOT NULL,
	"size_usdg" numeric(38, 18) NOT NULL,
	"entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tx_hashes" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_bars_1m" (
	"symbol" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"o" numeric(38, 18) NOT NULL,
	"h" numeric(38, 18) NOT NULL,
	"l" numeric(38, 18) NOT NULL,
	"c" numeric(38, 18) NOT NULL,
	"source" "price_source" NOT NULL,
	CONSTRAINT "price_bars_1m_symbol_ts_pk" PRIMARY KEY("symbol","ts")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "source_kind" NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"trust_weight" real DEFAULT 0.5 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"symbol" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"underlying_ticker" text NOT NULL,
	"name" text NOT NULL,
	"decimals" smallint NOT NULL,
	"pool_address" text,
	"pool_liquidity_usdg" numeric(38, 18),
	"proxy" text,
	"beta" numeric(10, 6),
	"last_close" numeric(38, 18),
	"active" boolean DEFAULT true NOT NULL,
	"eligible" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "triggers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"nl_text" text NOT NULL,
	"compiled_rule" jsonb NOT NULL,
	"channels" "delivery_channel"[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet" text,
	"email" text,
	"lang" text DEFAULT 'en' NOT NULL,
	"country" text,
	"tier" "user_tier" DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_has_identity" CHECK ("users"."wallet" is not null or "users"."email" is not null)
);
--> statement-breakpoint
ALTER TABLE "basket_legs" ADD CONSTRAINT "basket_legs_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "public"."baskets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baskets" ADD CONSTRAINT "baskets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commits" ADD CONSTRAINT "commits_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "public"."baskets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "public"."baskets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "public"."baskets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "headlines" ADD CONSTRAINT "headlines_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "headlines" ADD CONSTRAINT "headlines_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "public"."baskets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "basket_legs_token_uq" ON "basket_legs" USING btree ("basket_id","token_symbol");--> statement-breakpoint
CREATE INDEX "baskets_status_published_idx" ON "baskets" USING btree ("status","published_at");--> statement-breakpoint
CREATE INDEX "baskets_event_idx" ON "baskets" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "deliveries_basket_sent_idx" ON "deliveries" USING btree ("basket_id","sent_at");--> statement-breakpoint
CREATE INDEX "events_created_severity_idx" ON "events" USING btree ("created_at","severity");--> statement-breakpoint
CREATE UNIQUE INDEX "headlines_source_item_uq" ON "headlines" USING btree ("source_id","source_item_id");--> statement-breakpoint
CREATE INDEX "headlines_received_at_idx" ON "headlines" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "headlines_event_idx" ON "headlines" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "headlines_embedding_hnsw" ON "headlines" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "positions_user_idx" ON "positions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "positions_basket_idx" ON "positions" USING btree ("basket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tokens_address_uq" ON "tokens" USING btree ("address");--> statement-breakpoint
CREATE INDEX "tokens_underlying_idx" ON "tokens" USING btree ("underlying_ticker");--> statement-breakpoint
CREATE INDEX "triggers_user_idx" ON "triggers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_wallet_uq" ON "users" USING btree (lower("wallet"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));