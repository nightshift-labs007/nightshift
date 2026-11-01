# Nightshift Signals build spec

Condensed from *Nightshift Signals Product & Build Blueprint v1 (Oct 2026)*, slides plus implementation notes. Section numbers match the deck. Targets and thresholds are starting assumptions to tune with data.

## 1. Problem
- US exchanges trade 9:30–16:00 ET; news lands in the other 17.5 h and on weekends.
- Tokenized ETFs trade 24/7 but pools are shallow with no official price anchor.
- Signal channels don't grade themselves; traders can't tell skill from noise.

## 2. Loop (latency budget, p50 target 45 s, hard ceiling 60 s)
t+0 headline lands → t+8 event understood → t+30 basket built → t+40 hashed onchain → t+60 one tap to trade → 9:45 ET graded at the open (after opening auction prints settle).

## 3. Why now (re-verify before launch)
Robinhood Chain mainnet July 1 2026 (Arbitrum-based L2). Stock Tokens: ERC-20 tokenized debt securities issued by Robinhood Assets (Jersey) Ltd, self-custodied, DeFi-usable. ~$1B cumulative Uniswap tokenized stock volume by August. 120+ countries; **not US persons**. USDG is the native settlement stablecoin. Some ETF pools are tiny (one VTI token ~$16.7K TVL, 37 holders): liquidity checks are core.

## 4. Users
1. **Primary:** non-US retail trader on a phone (Mumbai, Dubai, Lagos), maybe in a second language. Needs the why in one sentence, the action in one tap. → mobile-first, multilingual from day one (English + Hindi, Spanish), theses ≤ 240 chars.
2. **Secondary:** crypto-native trader rotating into real-world exposure without leaving the wallet.
3. **Later:** AI agents/apps via a paid API. → every object has a stable ID and JSON Schema from day one.

## 5. User journey
| Step | User sees | System does |
|---|---|---|
| Alert | Push/Telegram/X card: headline, basket, one-line why | Fan-out within 5 s of publish |
| Basket page | Legs, weights, confidence, FV gap, analogs | Live prices over WS, slippage quote per leg |
| Size it | USDG slider; legs that slip too much grey out | Re-quote every 10 s against pool depth |
| Trade | One button per leg into their own wallet/DEX | Build deep links, log click (no custody) |
| Track | Live basket P/L overnight | Paper position from logged entry quote |
| Open | 9:45 ET push "Your basket closed +x.x%" | Grader, scorecard, share card |

Feed and scorecard are public, no account. Sign-in (wallet or email via embedded wallet) only for alerts, triggers, tracked positions. If a wallet is connected, verify actual fills from chain later.

## 6. Screens and routes
- `/` live feed: SSR first page then WS. Event cards: severity chip, sector tags, basket preview, countdown to open. Filters: sector, severity, region.
- `/b/[id]` basket detail + `/b/[id]/opengraph-image`: thesis, legs (live price vs fair value), slippage per leg, analogs, onchain proof link, size slider, trade buttons.
- `/e/[id]` event detail with every basket for that story.
- `/scorecard` all baskets graded: hit rate, avg return after slippage, vs SPY, by sector; misses as prominent as wins; CSV download. `/scorecard/[date]` one morning's report.
- `/me` alert channels, quiet hours, severity threshold, sector watchlist, triggers, tracked positions.
- `/docs/api` later.
- Every data component has states: loading skeleton, empty, live, stale (WS down > 15 s → banner), error.
- Dark by default, light supported. Hot accent = live/breaking, cool accent = graded/historical. Never use color alone for up/down: always a sign and a word.

## 7. Basket schema (Zod in packages/core)
```
id                  bkt_YYYYMMDD_HHMM_suffix
event_id
created_at, published_at   ISO UTC
thesis              ≤ 240 chars, tied to the source headline
thesis_i18n         { [lang]: string }
direction           long | short   (MVP: long only)
legs[]              2–4; { token_symbol, token_address, underlying_ticker, weight,
                      entry_quote_price, entry_quote_size_usdg, est_slippage_bps,
                      fair_value, fv_gap_bps }
                    weights sum to 1, max 0.5 each; registry tokens only
confidence          0–1 raw
confidence_calibrated 0–1 (against scorecard hit rate)
horizon             next_open | next_close | 1w   (MVP: next_open)
max_slip_bps
model_version, prompt_version
analog_event_ids[]
canonical_hash      keccak256 hex of canonical JSON
commit_tx
status              draft | published | graded | void
void_reason
```
Canonical JSON: keys sorted, no whitespace, numbers as fixed-decimal strings, so anyone can reproduce the hash.

## 8. Principles
See CLAUDE.md non-negotiables. Commit before you show; grade on real prices; nobody goes first.

## 9. Architecture
Sources (news wire, RSS, X lists; CME futures, BTC, gold; Uniswap pools, Chainlink; Stock Token registry) → Ingest + bus (news workers, price workers, Redis Streams, Postgres + pgvector) → Intelligence (triage, basket engine, fair value + sizer, committer + grader) → Delivery (REST + WS gateway, Next.js PWA, Telegram/X/web push/email, Robinhood Chain commits).

Deployables: web (Vercel), api (Hono, REST + WS, subscribes to Redis streams), worker (one process, BullMQ queues; split only when a queue's lag exceeds budget), Postgres, Redis, Solidity contract. The bus makes the pipeline replayable: run last month's headlines through a new prompt version and compare grades.

## 10. Pipeline
| Stage | Logic | Tech | Budget |
|---|---|---|---|
| Ingest | Poll/stream sources → `{source, source_id, url, title, summary, published_at, received_at, lang}`. Title, short summary, link only. | BullMQ | 5 s |
| Dedupe | Embed title+summary; cosine > 0.90 vs last 30 min joins that cluster. ≥ 3 independent sources = corroboration boost. | pgvector | 2 s |
| Triage | Market-moving? category, regions, severity 0–5. < 3 stored, not mapped. | Haiku 5.5 | 3 s |
| Map | Taxonomy, live registry, FV gaps, top-5 analogs in context → legs + thesis. Validate; retry once; drop. | Sonnet 5.5 | 15 s |
| Size | Quote each leg at reference size (e.g. 1,000 USDG); drop legs over slip cap; renormalize; < 2 legs → void `illiquid`. | Uniswap quoter | 5 s |
| Commit | Canonical JSON → keccak256 → onchain event | viem, Solidity | 10 s |
| Publish | Fan out WS, push, Telegram, X | API gateway | 5 s |
| Grade | 9:45 ET: legs at the open vs entry quotes | Cron (America/New_York) | daily |

Every stage writes its output event with timings for per-stage latency charts. If mapping is still running 5 min after the first headline, publish the event without a basket.

## 11. Events (Redis Streams, one stream per type, consumer group per service)
| Event | Producer | Consumers | Key fields |
|---|---|---|---|
| headline.ingested | ingest | dedupe | source, title, url, received_at |
| event.clustered | dedupe | triage | event_id, headline_ids, sources_n |
| event.triaged | triage | mapper, feed | category, severity, entities |
| basket.proposed | mapper | sizer | legs, thesis, confidence |
| basket.sized | sizer | committer | quotes, slip_bps, voided? |
| basket.committed | committer | publisher | hash, tx, block_time |
| basket.published | publisher | WS, bots, push | basket_id, channels, sent_at |
| price.tick | price worker | WS, sizer, FV | symbol, px, src, ts |
| alert.drift | fair value | WS, push | symbol, gap_bps, fv |
| basket.graded | grader | scorecard, push | ret_pct, vs_spy, hit |

Envelope `{id (ULID), type, version, occurred_at, producer, correlation_id, payload}`; correlation_id traces a headline to its grade. Immutable, versioned, idempotent consumers, dead-letter stream, 3 retries with backoff. `price.tick` stays in Redis (last value per symbol + 24 h ring buffer); 1-minute bars go to Postgres.

## 12. Data model (Drizzle, packages/db)
- sources: id, kind, url, trust_weight, active
- headlines: id, source_id, title, url, embedding
- events: id, category, severity, entities, sources_n
- baskets: id, event_id, thesis, conf, hash, status
- basket_legs: basket_id, token, weight, entry_px, slip_bps
- commits: basket_id, hash, tx, block, confirmed_at
- tokens: symbol, address, underlying, pool, proxy, beta
- price_bars_1m: symbol, ts, o, h, l, c, source
- grades: basket_id, exit_px, ret, vs_spy, hit
- users: id, wallet, email, lang, country, tier
- triggers: user_id, nl_text, compiled_rule, channels
- positions: user_id, basket_id, size, entry, tx_hashes
- **deliveries** (append-only audit): basket_id, channel, user_id nullable, sent_at, latency_ms. Powers the latency dashboard and proves nobody received a basket early.

Day-one indexes: headlines(received_at); HNSW on headlines.embedding (vector_cosine_ops); events(created_at, severity); baskets(status, published_at); basket_legs(basket_id); price_bars_1m PK (symbol, ts); grades(basket_id) unique.

Token registry refreshes every 15 min from the official Stock Token list + pool data. Eligible = active, pool above minimum liquidity, has a fair-value proxy. Money as numeric(38,18) or integer base units.

## 13. API and realtime
REST `/v1`: `GET /feed?since=&severity=`, `/events/:id`, `/baskets/:id`, `/baskets/:id/quote?usdg=`, `/baskets/:id/links?wallet=`, `/scorecard?from=&to=&sector=`, `/fairvalue/:symbol`; `POST /me/triggers`, `/me/positions`.

WS `/ws` channels: `feed` (event.triaged, basket.published), `basket:{id}` (leg ticks, drift), `scorecard` (grades), `user:{id}` (personal alerts; short-lived JWT). Client subscribes/unsubscribes; server sends snapshot then deltas with sequence numbers; on a gap the client refetches via REST. Heartbeat 20 s; client reconnects with exponential backoff and resubscribes.

Hono + zod-openapi (OpenAPI and TS client from the same schemas), `ws` library. Public REST rate limit 60 req/min/IP in Redis.

## 14. AI layer
- `classify_headline` tool: `{is_market_moving: bool, category: enum(geopolitics_energy, conflict_defense, semis_export, monetary_policy, trade_tariffs, china_macro, crypto_regulation, health_policy, earnings_megacap, other), regions: string[], severity: int 0–5, entities: string[], reason: string ≤ 160}`
- `propose_basket` tool: `{thesis ≤ 240, direction: long, legs: [{underlying_ticker: enum built at request time from eligible registry, weight}], confidence 0–1, skip: bool, skip_reason}`
- System rules: sector exposure, not personal advice; prefer 2–3 legs; ≤ 0.5 weight per leg; no price targets; thesis cites the headline; if likely priced in (FV gap already larger than a typical move for the category) → skip.
- Context: cluster headlines, taxonomy, eligible tokens, live FV gaps, 5 nearest past events (pgvector) with real graded moves.
- Prompt caching for static system prompt + taxonomy. Log every prompt/response with basket id. Keep old schemas compatible for replay.
- Eval harness: replay months of past headlines through a new prompt version, grade offline, ship only if after-slippage hit rate beats current.

## 15. Taxonomy (packages/core/taxonomy.yaml, versioned, editable without deploy)
Per category: description, example headlines, candidate tickers (preference order), FV proxy, default beta.

| Category | Candidates | Off-hours proxy |
|---|---|---|
| Oil supply, Middle East | XLE, USO, GLD | Crude, gold futures |
| Conflict, defense | ITA, XAR, GLD | ES, gold |
| Chip export controls | SMH, SOXX | NQ |
| Fed / rates surprise | TLT, XLF, QQQ | Treasury, NQ futures |
| Tariffs and trade | XLI, EEM, FXI | ES, FX |
| China stimulus | FXI, KWEB, COPX | Copper, HK index |
| Crypto regulation | IBIT, other BTC ETFs | BTC spot 24/7 |
| Health policy | XLV, XBI | ES |

Only tickers with a live, liquid Stock Token are eligible; the registry decides. A category underperforming 4 straight weeks auto-disables and is flagged.

## 16. Off-hours fair value
```
FV      = last_close × (1 + β × Δproxy)        Δproxy = proxy return since 16:00 ET close
gap_bps = (token_mid − FV) / FV × 10,000
```
Proxies: broad/sector equity → ES; QQQ, SMH, SOXX → NQ; GLD → GC; USO, XLE → CL blended with ES; TLT → Treasury futures; BTC ETFs → BTC spot. β: regress ETF overnight-gap returns on proxy same-window returns, rolling 60 trading days, refit weekly. Futures pause daily and on weekends: FV is frozen then (except BTC-linked) and the UI must say so. Drift alert when gap > 150 bps. Skip legs that already moved past a typical reaction. UI shows token price, FV and gap side by side. (This module is also the Nightshift fallback product.)

## 17. Execution
**Phase 1 (week 4):** deep link per leg, prefilled USDG → token swap sized by weight, into Robinhood Wallet or Uniswap app. Confirm Uniswap URL params and Robinhood Chain identifier from current docs; check Robinhood Wallet deep-link/WalletConnect. Fallback: WalletConnect, we build the swap tx against the Uniswap router, user signs. Each click writes a position row with the quote.
**Phase 2 (after legal review, out of scope):** immutable ownerless router batching all legs, per-leg amountOutMinimum, atomic revert, simulate before signing, audited.
US blocked at the edge before any trade link renders.

## 18. Onchain proof and grading
```solidity
contract NightshiftSignalsLedger {
  address public immutable committer;
  event BasketCommitted(bytes32 indexed basketId, bytes32 hash, uint64 ts);
  function commit(bytes32 basketId, bytes32 hash) external {
    require(msg.sender == committer);
    emit BasketCommitted(basketId, hash, uint64(block.timestamp));
  }
}
```
Batch commits landing in the same second. Key holds gas only.

```
r_leg    = exit / entry_quote − 1
r_basket = Σ w × r_leg
alpha    = r_basket − r_SPY            hit = alpha > 0 after slippage
```
Exit = token at 9:45 ET; also record the underlying's official opening print as a second exit. Void only if a leg's token was halted or pool paused at the open; voids listed with reason, never removed. Metrics: hit rate, mean/median alpha, worst basket, by category and by confidence bucket (calibration chart). Publish CSV and the open-source grading script daily at 9:45 ET.

## 19. Frontend
Next.js App Router + TS · Tailwind + shadcn/ui · TanStack Query + Zustand · TradingView Lightweight Charts · Framer Motion · wagmi + viem + Privy · native WS with resync · Web Push (VAPID) + service worker · next/og share cards · next-intl.

Folders: `app/(public)/page.tsx`, `app/(public)/b/[id]/{page,opengraph-image}.tsx`, `app/(public)/e/[id]`, `app/(public)/scorecard`, `app/(auth)/me`; `components/feed` (EventCard, SeverityChip, SectorTags, OpenCountdown), `components/basket` (LegRow, FairValueGap, SlippageBadge, SizeSlider, TradeButtons, ProofLink, AnalogList), `components/scorecard` (HitRateCard, AlphaChart, CalibrationChart, BasketTable); `lib/ws.ts`, `lib/api.ts`, `lib/links.ts`.
Targets: feed first-load JS < 150 KB, LCP < 2 s on mid-range Android over 4G. Native app (Expo) only after PWA retention proves demand.

## 20. Backend
Node 22, TS, pnpm, Turborepo · Hono, zod-openapi, ws · BullMQ, Redis Streams · Postgres, pgvector, Drizzle · Claude API · news: free RSS (wires, central banks, commerce/treasury, OPEC) + curated X list, later one paid wire (e.g. Benzinga); GDELT for history backfill · market data: CME via e.g. Databento, BTC exchange WS · chain: viem, Foundry, Uniswap quoter; Chainlink only as sanity check · messaging: Telegram Bot API, X API, Resend. Every vendor behind an adapter interface (NewsSource, PriceSource, QuoteSource, Notifier).

## 21. Infra, security, compliance
Web on Vercel; api + worker on Fly.io or Railway; managed Postgres (Neon/Supabase) and Redis; Sentry, Axiom, PostHog; latency dashboard per stage with paging; GitHub Actions test → migrate → deploy.
US IP block at the edge (Vercel/Cloudflare geo headers), country at sign-up, wallet sanctions screening (Chainalysis/TRM free endpoints), audit log of what was shown to whom and when, secrets in a vault, "information, not advice" labels, lawyer review before one-tap trading or any token. One runbook per failure mode (news down, model errors, chain congestion, stale prices); when upstream is stale, the UI shows it.

## 23–24. Ideas backlog (ship only if it strengthens trust, habit or sharing)
- **Receipt cards (MVP):** OG image per basket and per user result: headline, legs, result at open, short proof hash. Misses too.
- Follow or fade: vote per basket, locked at publish + 30 min, crowd graded like the AI. (S)
- Paper league: paper USDG, weekly leaderboard; no monetary prizes. (S)
- Historical analogs: expose the 5 nearest past events with graded outcomes; backfill a year from GDELT. (M)
- Night Replay: 1-minute bars 16:00–9:45 ET + event markers with a scrubber. (M)
- Plain-English triggers: fast model compiles to `{categories[], min_severity, entities[], regions[], channels[]}`, user confirms, evaluated on every event.triaged. (M)
- Morning voice brief, fair-value radar (number printed in each cell), Telegram mini-app, why-graph (2–4 causal steps as SVG), Agent API + MCP (get_feed, get_basket, get_scorecard, subscribe), lock-screen tracking (native, later).

## 25. Token and business model
Token unlocks tools (custom triggers, API credits, deeper analogs/replay, league flair), **never** earlier access, revenue share or promised returns, never before 6 weeks of public record or before a legal opinion. Billing works in USDG first (Pro plan, metered Agent API); token is an optional discounted payment method.

## 26. Roadmap
| Week | Build | Done when |
|---|---|---|
| 1 | Monorepo, schema, bus, news + price ingest | Headlines and ticks flowing into Postgres |
| 2 | Triage, mapper, sizer, registry, ledger contract (testnet → mainnet), committer | Baskets committed onchain silently |
| 3 | Grader (9:45 ET, America/New_York), scorecard, Telegram + X bots | First morning scorecard posted |
| 4 | Feed, basket page, deep links, receipt cards, geofence | Private beta, 50 traders |
| 5–6 | Web push, drift alerts, follow or fade, Hindi + Spanish | Public launch, p50 < 45 s |
| 7–9 | Analogs, replay, paper league, eval harness | Six weeks of graded history |
| 10+ | Legal review, router, Pro, Agent API, token | Only if the record clears the bar |

## 27. Metrics and gates
p50 headline→publish 45 s (deliveries table) · hit rate > 55% after slippage vs SPY (grades) · 30% D7 open the morning receipt · 1 in 10 receipt cards shared. Instrument from week 2.
**Pivot gate, week 9:** hit rate ≤ 50% across 6 weeks → stop selling calls; relaunch as **Nightshift**, live off-hours fair value for tokenized ETFs.

## 28. Risks
| Risk | Level | Mitigation |
|---|---|---|
| Thin pools, slippage | High | Quote every leg, publish reference size, re-quote every 10 s, grey out over-cap legs, grade after slippage |
| AI calls wrong | High | Public misses, calibration, auto-disable weak categories |
| Advice/securities rules | High | Non-custodial, same output for all, legal gates |
| News licensing | Medium | Headline, summary, link only; free feeds first |
| Platform dependence | Medium | Adapters; watch Robinhood announcements weekly; Nightshift fallback |
| Latency misses | Medium | Per-stage budgets, alerts, skip mapping when late |
| Key/contract exploit | Low | Gas-only key, no funds held, audited router in phase 2 |

## 29–30. Handoff
Run each session: read CLAUDE.md + named sections, short plan, implement, tests, demo, commit. Stop and ask for unknown vendor details. Run session 6's replay against the previous week's headlines before going live.

**Ship the record first:** start committing baskets in week 2, before anyone sees the product.
