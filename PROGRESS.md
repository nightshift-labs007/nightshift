# Nightshift: progress log

A running log of decisions, finished work and open questions, so any new session can pick up from here.
Newest entries go at the top of each section.

## Current phase

**Phase 3.5 (go-live readiness): done 2026-11-21 on branch `phase-3-5`, waiting for "go".**
- `main` contains Phases 1, 2A and 3 (Phase 3 merged locally). **Not pushed**; `main` is 27 commits ahead of `origin/main`.
- `phase-3-5` is not merged.
- **Not done: a real preview deployment.** I have no hosting access, and the Vercel project is disabled. The smoke test ran instead against a local production build started as a Vercel preview, then as production (see Done).
- No contracts, funds or secrets were touched.

**2026-11-21, push authorized by the owner. Paused before pushing (nothing pushed yet):**
- **Step 1 (pre-push checks) passed:**
  - `origin` = `github.com/nightshift-labs007/nightshift`, **PUBLIC**; the account has admin rights.
  - Secret scan of all 140 commits on every local and remote branch (137k added diff lines):
    - no API keys, tokens, RPC URLs with keys, Upstash, Resend, Vercel or Privy secrets, PEM blocks or mnemonics;
    - the only hits are lockfile integrity hashes, plus Hardhat's three **public** default test keys in `scripts/` (derived addresses checked: none is a Nightshift owner or role wallet).
  - `.env*` (except `.env.example`) and `.vercel` are gitignored and were never committed. `.env.example` has no values.
  - New commits are authored as `jalaj88 <jalaj8985@gmail.com>`, already public on origin.
  - Push dry run: `main` fast-forwards (488ea0d→4cb31fd), 4 new branches, no force needed.
- **Why paused (step 3 findings):** the repo has two deployment integrations.
  - Vercel project `nightshift3` (team `talonrobotics48-7144`, the one returning 402).
  - Railway project with services "Nightshift" (production deploys of `deploy/railway-backend`, latest 11 Nov) and "sunny-prosperity" (deployed **`main`** @488ea0d to production on 10 Nov).
  - Pushing `main` may therefore start a production deploy on Railway and/or Vercel. The owner asked for production only after a "go".
- **Parallel work found:** Sarthak's `origin/deploy/railway-backend` (6 commits, 10–14 Nov, not in `main`) splits hosting:
  - pages on Vercel, every `/api` route on Railway behind a proxy secret;
  - replaces Upstash with **Railway Postgres** as the private store;
  - **deletes the X agent**;
  - its doc copies every Vercel variable, including the on-chain keeper keys, to Railway.

  Our `main` (Phases 1–3.5) assumes Vercel + Upstash and changes the X agent. The two need reconciling before either goes live.
## Decisions

- 2026-11-21 (owner): deploy a **separate, temporary staging copy on a new Railway project**, deployed from the laptop with `railway up` (no GitHub push, so the existing Vercel `nightshift3` and Railway services, and `main`, are untouched).
  - Storage: Upstash free tier (our store speaks Upstash's REST API).
  - Address: the Railway `*.up.railway.app` domain; nightshift.buzz unchanged.
  - Secrets: entered by the owner in Railway's dashboard only.
  - Code prep (commit b566ba4): test mode also allowed with `NIGHTSHIFT_ENV=staging` + `PLAY_TEST_MODE=1` (never with `NIGHTSHIFT_ENV=production` or Vercel production; unit-tested); links use `RAILWAY_PUBLIC_DOMAIN`; `railway.json` (build, start, health check `/api/ops/health?soft=1`); `.railwayignore`.
  - Status: waiting for `railway login` (the CLI's saved session had expired).

- 2026-11-21 (Phase 3.5, my choices, cheap to undo):
  - **Scheduler:** game jobs moved from `/api/keeper` to `/api/jobs/play` (every 5 min); the keeper stays every 10 min (cron-job.org; see `docs/DEPLOY.md`). Every job records a heartbeat (`lib/ops.ts` `runJob`).
    - A job is **stale** after 3 missed intervals of **scheduled, successful** runs. Page-triggered backstop runs never count, so a stopped scheduler can't hide.
    - `/api/ops/health` returns 200 when ready, 503 when not, for uptime monitors.
  - **Test mode** (`lib/play/testmode.ts`): the test clock, dev outbox and test routes work locally, and on a Vercel **preview** only with `PLAY_TEST_MODE=1`. Never in production, whatever the flags say (unit-tested).
  - **Abuse caps:** codes 10/h and 20/day per IP, 3 per 10 min and 5/day per address; **all email 10/day per address**; picks 60/min and 2,000/day per IP, 120/h per player; shares 30/h per player; Turnstile on sign-in when configured. Durable only with Redis.
  - **Monitoring without a third-party service:** server errors through `instrumentation.ts` `onRequestError`, browser errors through `ErrorReporter`. Both are scrubbed (no emails, keys or ids) into a 50-entry log at `/api/ops/errors` (Bearer `CRON_SECRET`). Sentry can be added later in `instrumentation.ts`.
  - **Analytics** keyed by the anonymous player id only (no IP, email or user agent): daily counts of visit, pick, signup, code_sent, share_created, share_view, reminder_sent, reminder_click; active days per player; D1/D7 by first-seen cohort. All at `/api/ops/metrics` (Bearer).
    - **Reminder "opens" are measured as clicks** through `/r/{kind}` links. Open pixels are unreliable and more invasive.
  - **Privacy:** players can delete their game account (email, nickname, picks; aggregate counts stay). The privacy and terms pages are **drafts for legal review**, with a placeholder contact address.
  - **Kill switch:** `PLAY_REMINDERS=off` pauses all reminder emails.

- 2026-11-20 (Phase 2B, by the owner):
  - Settlement **Option B**.
  - Real stakes later for **SPY and GLD only**; all 5 assets stay in points mode.
  - **Keep invite-gating** for real stakes.
  - Starting **fee 3%** and small per-pick caps, adjusted after legal review.
  - **Legal review before any real-stakes launch.**
  - No contract work yet.
- 2026-11-21 (Phase 3, my choices, cheap to undo):
  - **Price provider:** everything that settles (both games and the keeper's Call the Open) uses `lib/prices` `officialClose` / `officialOpen`. Yahoo is the default (`PRICE_PROVIDER=yahoo`). Confirmed prices are cached forever per provider. A throttling host (429 or 5xx) is skipped with backoff (1, 2, 4, 8, 16, then 30 min). A licensed feed implements `PriceProvider` and is added to `PROVIDERS`.
  - **Sign-in = email code** (6 digits, 10 min, 5 tries), chosen because Resend is already set up, it recovers across browsers, and reminders need an email anyway.
    - No-wallet play keeps working. A new email creates an account that keeps the browser's id; a known email signs in and merges the browser's picks. Where both picked the same asset, the account's pick stays and the duplicate crowd count is removed.
    - The cookie (`ns_play`) holds the account id. It never appears in links.
    - Locally, without Resend, emails go to a dev outbox (`/api/play/dev/outbox`, 404 in production).
  - **Leaderboard:** signed-in players only, by nickname (3–16 chars a–z 0–9 _), this week (Mon–Fri ET) and all time. Order: points, then accuracy, then rounds, then name. No emails or ids.
  - **Beat the AI:** points only, assets NVDA/AAPL/TSLA/SPY/GLD.
    - Nightshift's call = the engine's fair value (live prices only) taken at 20:00 ET (17:00 after an early close).
    - Picks lock at **04:00 ET** (before pre-market). Settled at the 09:30 open, compared to the cent. +10 per correct pick, no streak bonus; points add to the same total.
    - The call is stored off-chain and never described as recorded on Base.
  - **Share cards:** built on the server from the player's real picks and results, signed (HMAC with `PLAY_SECRET` or `CRON_SECRET`), so edited links fail. Page `/s/{token}` with a PNG card image; X and Telegram share links. Words instead of symbols on the image (the image font has no arrows).
  - **Reminders:** email only (Telegram needs a bot and chat linking; later if wanted). Opt-in per type:
    - round opens (and Beat the AI's call is up);
    - 1 hour before the lock, only if assets are still unpicked;
    - your results.

    Each is sent at most once per player, only inside its window, with a one-click unsubscribe (signed by email hash, not the id). Run by the keeper and after page loads.

- 2026-11-20 (Phase 2A, decided by me as cheap to undo):
  - Rounds are named by their lock date D. There is always exactly one round taking picks: the first trading date whose close is still ahead. So you can pick at any hour, and after Friday's close picks go to Monday's round.
  - **Data source:** Yahoo Finance public chart API (unofficial, no key).
    - **Close** = the daily bar's `close` for D, accepted only within 0.5% of D's last 5-minute bar's close.
    - **Open** = `officialOpen()`: the 1-minute and 5-minute bars at 09:30:00 ET must agree within 0.3%.
    - Anything missing means retry. A round still missing prices 72 h after the open is void (no points, streak kept).
  - **Flat rule:** close and open are both rounded to the cent. The same cent is flat, which is a push: no points either way.
  - **Points:** +10 per correct pick, 0 for wrong. +5 streak bonus per settled round played once your streak is 3 or more.
  - **Streak:** consecutive rounds with at least one pick. Skipping a locked round resets it. The open round counts once picked.
  - **Accuracy:** wins / (wins + losses).
  - **Identity:** an anonymous httpOnly cookie (`ns_play`, 400 days); no wallet, no account. Progress lives in that browser only (Phase 3 adds saving it to an account).
  - **Blind crowd:** you see the up/down split only for assets you've picked this round.
  - **Test clock:** the `x-play-now` header is honoured only when `NODE_ENV !== "production"`.
- 2026-11-20 (pre-Phase 2): X agent accuracy posts use only calls recorded on Base (`lib/x-text.ts`); **X posting is off unless `X_POSTING=on`**. `engines.node` is `>=22.6`.
- 2026-11-20 (Phase 2 design input, answers Q1 and Q2):
  - The main game, "up or down vs last close", **locks at the 16:00 ET close**. The pick window is the US trading day; the Friday lock covers the weekend round.
  - Assets: **NVDA, AAPL, TSLA, SPY, GLD**.
  - Keep time-weighted shares.
  - **"Beat the AI"** is a separate evening mode (the 20:00 ET call), points and leaderboard only.
  - **Points mode uses fixed rewards, not pools.** Real-stakes pools keep the refund rule (flat or one-sided = refund).
- 2026-11-20 (Phase 1): "Our last call" shows only calls recorded on Base before the open. The backtest replay is never shown as a call. Where a replay appears (Scorecard, ETF page, shift report), its note now says it reads futures at the moment of the open.
- 2026-11-20 (Phase 1): Read-only ledger access uses the public updater address from the deployment (`ledgerReadAddress`). Writing still requires the private key (`ledgerAddress`).
- 2026-11-20: Main Predict pick becomes "up or down vs last close" on 5 headline assets. "Beat the AI" stays as a second layer: a leaderboard comparing users with Nightshift's call.
- 2026-11-20: Launch rounds are the overnight round and a Friday-close → Monday-open weekend round. "Call the Close" comes later.
- 2026-11-20: Keep parimutuel pools (winners split the losers' pool minus a small fee). Flat = refund. Skip market holidays.
- 2026-11-20: Free points-only practice mode comes before any expansion of real stakes. Real stakes stay small and capped.
- 2026-11-20: Process: phases 0–5, stop for "go" after each one; branch + small commits; tests; browser check; update this file.

## Phase 0 findings (2026-11-20)

### Root causes

| # | Symptom | Root cause | Evidence |
|---|---|---|---|
| R1 | Predict shows rounds "for the Fri, Nov 6 open"; recent rounds end Nov 5 | **Production is down.** nightshift.buzz returns `402 DEPLOYMENT_DISABLED` (Vercel). The keeper that opens and settles rounds (`/api/keeper` → `runPredictions` in `lib/chain/predictions.ts`) only runs on production, called by an outside scheduler with `CRON_SECRET`. On-chain prices stopped about 2026-11-06 15:00 UTC. Locally the keeper can't run either: no `.env.local`, so there's no keeper key or Redis. | `/api/health`: "keeper wallet not configured", on-chain prices ~19,880 min old. `/api/predict`: 17 rounds, sessions Nov 5–6 only. |
| R2 | Nov 5 rounds all "Refunded" with empty pools | Working as designed: one-sided or empty pools refund. Total staked across all 17 rounds is 0.3 USDC. | `/api/predict` |
| R3 | 12 Nov 6 rounds never finish | Opens were proposed on-chain, but `finalize` (after the 2h challenge window) needs the keeper, which stopped. Status is still "Proposed". | `/api/predict` |
| R4 | Stale calls compared with live prices (GLD −12%, SLV −18%, ETHA −22%) | `PredictTab.tsx` (`RoundCard`, ~line 428) shows "Now: fair value vs call" for every round that isn't settled. Proposed rounds count as not settled, so a 14-day-old call sits next to today's price. There is no check on the round's age. | code |
| R5 | "Our last call" blank | `/api/ledger` returns `{configured:false}` because `ledgerAddress()` (`lib/ledger.ts:45`) derives the ledger address from `ORACLE_UPDATER_PRIVATE_KEY`, which isn't set locally. **Reading** the public record only needs the public address. The UI then falls back to `/api/shift-report`, which takes 12–17 s on a cold load, so the column stays empty for a long time and then fills in. | headless Chrome: column filled after ~17 s with "Thu, Nov 19 …" |
| R6 | **(new, serious) "Our last call" shows a backtest, labelled as a recorded call** | When there's no on-chain record, `latestCalls()` in `FairPrices.tsx` uses `lib/backtest.ts`. That replay samples futures **at the moment of the open** (`priceAt(anchor, s.openT)`), so it shows misses of 0.03–0.11%. The welcome guide calls it "the opening price we recorded on Base before the last open". The real locked evening calls (the 17 on-chain strikes) missed by a **median of 0.85%** (mean 1.09%, SMH +5.1%). The UI overstates accuracy roughly tenfold. | `/api/shift-report` vs `/api/predict` strikes |
| R7 | "Big stocks" stuck on "Loading stocks…" | Not reproduced: `/api/stocks` returns 200 in 1.5–8.5 s (dev log) and the section rendered in headless Chrome after ~11 s. But `useApi` (`components/useApi.ts`) has no error or timeout state: if the first request fails, the skeleton stays until the next refresh 2 minutes later. Likely a slow or failed first load. | dev log, headless probe |
| R8 | "2 Issues" in the dev overlay | (1) Privy build warning: optional peer `@farcaster/mini-app-solana` not installed (harmless, from `PrivyRoot.tsx`). (2) `https://nightshift.buzz/brand/nightshift-n-128.png` → 402, hard-coded absolute URLs in `components/PrivyRoot.tsx:21` and `lib/wallet.tsx:112`; they break whenever production is down. No runtime exceptions. | headless Chrome console |
| R9 | Why rounds open at 20:00 ET | `openEveningRounds` waits until `lastClose + 4h` and then uses Nightshift's fair value at that moment as the strike. 20:00 ET is when US after-hours trading ends, and CME futures reopen at 18:00 ET after their daily break, so by 20:00 the call includes earnings and after-hours moves. The new "vs last close" pick needs no call, so it **can** open at 16:00. See Q1 for why it shouldn't stay open blindly until pre-market. | `lib/chain/predictions.ts:122–133`, `docs/PREDICTION_MARKET_PLAN.md` §3.1 |

### Other facts worth knowing
- The real-USDC prediction contract is on Base mainnet (`0xb8eb03…64ea`), caps 10 USDC/prediction and 25/wallet/round, fee 0. Contract changes to it need explicit approval.
- `README.md` is outdated (Algorand, Windows paths).
- Tests are standalone scripts (`scripts/test-*.mjs`, `test/*.test.mjs` via `node --test`). There's no `npm test`.

## Open questions

- **Q15 (new, blocks the beta):** someone with Vercel access must resolve the `402 DEPLOYMENT_DISABLED` (or create a new project), then follow `docs/DEPLOY.md`. Check whether Vercel's Hobby terms (personal, non-commercial) fit, or use Pro.
- **Q16 (new, blocks the beta):** a contact address for the privacy and terms pages, and a legal review of both.
- **Q17 (new):** no admin page. Renaming an offensive nickname or deleting someone's account is done in Redis or code (`docs/DEPLOY.md` §11).
- **Q18 (new):** the real-stakes prediction contract and its keeper are still in the codebase. The runbook says not to add the on-chain keys for this beta. Decide whether the Predict tab's real-USDC section should be hidden during the beta.

- Q11 is now covered by `docs/DEPLOY.md`. **Original note: production needs, before Phase 3 can go live:**
  - `RESEND_API_KEY` and `RESEND_FROM` for codes and reminders (without them, sign-in says email isn't set up);
  - `PLAY_SECRET` (or `CRON_SECRET`) for codes, unsubscribe links and share cards;
  - `SITE_URL` if not nightshift.buzz;
  - Upstash Redis (otherwise everything is in memory and lost on restart);
  - the keeper's outside scheduler (Q3).
- **Q12 (new): scale limits to revisit.** The leaderboard and reminders walk every account on each run (fine for hundreds of players). Past that, keep running totals at settlement. Price backoff is per server instance (in memory), not shared.
- Q13 partly addressed in Phase 3.5 (daily caps, per-player limits, Turnstile option). **Original note: abuse.** Anonymous picks are rate-limited per IP but not per person; the leaderboard counts signed-in accounts only, and one email = one account. Turnstile (already in the repo) could gate sign-in if fake accounts show up.
- **Q14 (new):** email reminders state times in ET only. Phase 4 adds the player's own time zone.
- **Q8 (new): Yahoo is a fragile source.** It returned HTTP 429 on both hosts for most of 2026-11-20, partly because the dev server polls it too. The points game copes (retries, 20 s budget, void after 72 h), but a licensed feed, or Twelve Data as a keyed fallback, should come before real money.
- Q9 resolved in Phase 3 (email sign-in). Q10 resolved in Phase 3 (Beat the AI built).
- Q6 resolved (X agent). Q7 resolved (Node engines).

- **Q6 (new, Phase 1): the X agent posts replay numbers as performance.** `lib/xagent.ts:135` and `lib/xmix.ts:73` post "off by X%" from the shift-report replay (futures at the open). It only runs on production, so it's dormant while hosting is down. Before production comes back, it should post only recorded calls, or label replays clearly. Not changed yet because it's outward-facing and can't be tested without X keys.
- **Q7 (new):** `npm test` needs Node ≥ 22.6 (`--experimental-strip-types`), but `package.json` says `engines.node >= 20`. Fine locally (Node 22.14). Either bump `engines` or keep tests on 22+ only.
- Q1 and Q2 are answered (see Decisions, 2026-11-20 Phase 2 design input).
- **Q1 (Phase 2, important): the answer is visible before the lock.** NVDA, AAPL, TSLA and SPY trade after hours (16:00–20:00), overnight (Blue Ocean / 24-hour brokers) and in pre-market, and their tokens trade 24/7. With "up or down vs last close" locked at 04:00 ET, the overnight price usually already shows the answer. People pile onto the obvious side, payouts fall toward 1.0×, and one-sided pools refund. Options: (a) lock at the 16:00 close, so the pick window is the trading day before; (b) keep time-weighted shares and close earlier; (c) compare against a reference price at lock time instead of the last close. Needs a decision before Phase 2.
- **Q2:** The fifth headline asset. Tentative suggestion: Gold (GLD). It isn't tech, it's driven by macro and geopolitics, and it's popular with users in India. Bitcoin is weak here because it trades 24/7 in plain view.
- **Q3:** Who restores production hosting (the Vercel account owner) and the outside scheduler for `/api/keeper`?
- **Q4:** What happens to the 12 Proposed rounds on mainnet? They have no stakes. Finalizing them needs the keeper key (owner action).
- **Q5:** Earlier ideas from 2026-11-20 not yet scheduled: blind call (user picks before seeing the AI), and crowd calls blended into the public signal (never into lending prices).

## Done

- 2026-11-21: **Phase 3.5** on branch `phase-3-5`:
  - **Docs:** `docs/DEPLOY.md` (runbook: services, secrets, every env var with its production/preview scope, setup order, scheduler, monitoring, abuse limits, incident table) and `docs/BETA_CHECKLIST.md` (before inviting, invite text, daily checks, metrics and targets, tester questions, stop rules, exit criteria). `.env.example` updated.
  - **Code:** `lib/ops.ts`, `lib/ops-rules.ts`, `lib/play/testmode.ts`, `lib/turnstile.ts`, `/api/jobs/play`, `/api/ops/{health,errors,metrics,error}`, `/r/[kind]`, `/api/play/account/delete`, `/privacy`, `/terms`, `instrumentation.ts`, `components/ErrorReporter.tsx`.
  - **Unit tests:** 67/67 (6 new: staleness, scrubbing, retention cohorts, test-mode gating). Typecheck: 0 errors in source.
  - **`scripts/test-play3.mjs`:** 38/38 (adds account deletion). **`scripts/test-play.mjs`:** 17/17.
  - **`scripts/smoke.mjs` (new), three runs:**
    - dev server: 16 passed, 1 skipped (no `CRON_SECRET` there);
    - **local production build started as a Vercel preview** (`VERCEL_ENV=preview`, `PLAY_TEST_MODE=1`, a test `CRON_SECRET`): **22/22**, covering sign-in, pick, lock at the close, settlement from real prices (SPY 715.87 → 713.56), one results email with tracked and unsubscribe links, scheduler endpoints and heartbeats, scrubbed error log, analytics counts, code and pick limits;
    - **the same build started as production** (with `PLAY_TEST_MODE=1` set on purpose): 20 passed, 1 skipped. The dev outbox and test routes return 404, the test clock is ignored, metrics need the secret, strict health returns 503 without Redis and email. The skip: code limits can't run without Resend.
  - **Browser (headless Chrome):** the privacy page renders with the draft banner; the game shows the "not financial advice" notice; no console errors.
  - **Merge:** Phase 3 merged into `main` locally after 61/61 tests. Not pushed.
  - **Noticed:** `next build` rewrites `tsconfig.json` to include its build folder. Reverted; it happens with any `NEXT_DIST_DIR`.

- 2026-11-21: **Phase 3** on branch `phase-3`:
  - **Code:** `lib/prices/` (provider, backoff, Yahoo parsing), `lib/play/{account,mail,ai,leaderboard,share,remind}.ts`, `/api/play/account/{code,verify,settings,signout}`, `/api/play/leaderboard`, `/api/play/share`, `/api/play/unsubscribe`, dev-only `/api/play/dev/{outbox,ai-call}`, `/s/[token]` with `opengraph-image`, `components/PlayParts.tsx`.
  - **Unit tests:** 61/61 (`npm test`). New ones cover price backoff and confirming the close and open, the Beat the AI calendar (weekend, Thanksgiving, early close), weekly points, no streak bonus in Beat the AI, and leaderboard order.
  - **`scripts/test-play3.mjs` (new), 34/34 against the dev server:**
    - email code: wrong code, used once, nickname taken;
    - a second browser merged into the account, with no double-counted crowd;
    - Beat the AI: before the call, an asset without a call, the 04:00 lock;
    - real settlement of both games from Yahoo: Beat the AI SPY call $714 → open $713.56 = below;
    - points = both games;
    - results email sent once; unsubscribe link has no id and turns everything off;
    - leaderboard shows the player with the right points and no emails;
    - share link, page and PNG card render; an edited link is rejected;
    - lock reminder lists the unpicked assets;
    - sign-out clears the cookie.
  - **`scripts/test-play.mjs` (2A):** still 17/17.
  - **Production build** (`next build` in a separate folder): succeeds. Its only warning is pre-existing (viem/ox via Earn).
  - **Browser (headless Chrome):** no console errors on the game page. Signing in through the form works end to end (outbox code → "Signed in as …"). Reminder toggles now update instantly (they lagged about 2 s and looked unchecked; fixed with an optimistic update).
  - **Share card image:** the first version rendered overlapping text and missing-glyph boxes; fixed and re-checked visually.
  - **Merge:** `phase-2a-points` (with `phase-1-fixes`) merged into `main` locally after 49/49 tests. Not pushed. A typecheck on that branch showed 20 errors, all in stale `.next/types` generated for Phase 3 routes by the running dev server (0 in source).

- 2026-11-20: **Phase 2** on branch `phase-2a-points`:
  - **2A, points game (built and tested):**
    - Code: `lib/time.ts` (round calendar), `lib/play-rules.ts` (rules), `lib/play/{store,settle,state}.ts`, `GET /api/play`, `POST /api/play/pick`, settlement in `/api/keeper` and after each `GET /api/play`, `components/PlayGame.tsx`, shown first in the Predict tab with the real-USDC rounds below.
    - Storage: Redis in production, in-memory locally.
    - Unit tests: 49/49 (`npm test`, including 8 calendar and 6 rules tests).
    - End to end: `node scripts/test-play.mjs` against the dev server, 17/17. It covers validation, the lock boundary (1 s before vs exactly at the close), crowd counts and changing a pick, a 3-round streak, and **real settlement of the Thu 19 Nov round from Yahoo**: SPY 715.87 → 713.56 "down", GLD 335.18 → 326.98 "down", points 15 (10 + 5 streak bonus).
    - Browser (headless Chrome, desktop and 390 px phone width): no console errors. Picking "Up" with no wallet saves the pick, shows the crowd line and updates the stats. The lock time shows in local time and in ET.
    - Bug found by the e2e test and fixed: a settlement request hung for 301 s while Yahoo returned 429s. Settlement now has a 20 s budget per round.
  - **2B, real stakes:** design only, in `docs/PHASE2B_REAL_STAKES_DESIGN.md`. The deployed contract can't set the strike after the lock, so this needs a v2 contract. It covers four settlement options with a recommendation, other v2 changes, risks, a testnet plan and the audit scope.
  - **Answered: can users withdraw from an overdue round without the keeper?** Yes, on today's contract: `finalize` (undisputed, 2 h after the proposal), `cancel` (24 h after the open) and `claim` are all permissionless, and `pause` doesn't block them. But there's no UI for it (Basescan and ETH for gas only), and `finalize` and `cancel` race after 24 h, so a losing bettor can force refunds. Both are in the 2B risks; the fix is in 2B §4.3.
- 2026-11-20: **Pre-Phase 2 fixes:**
  - X agent text builders (`lib/x-text.ts`, 6 tests, no X keys needed) accept only recorded calls.
  - The `graded` and `trackRecord` posts now skip when there's no recorded call.
  - Posting is off by default.
  - `engines.node >= 22.6`.

- 2026-11-20: **Phase 1** on branch `phase-1-fixes` (not merged, not pushed):
  - **Stale-data guard** (`lib/round-view.ts`): a round's call is compared with a live price only until its own open. Rounds more than a day past the open show "Settlement is overdue". When every current round is overdue, Predict says "No round is open right now" instead of "closed for this session".
  - **Empty pools:** "Be the first to call it" while open, "Nobody predicted on this round" after. One-sided pools say "no one on the other side yet" instead of "pays 1.00×". Small stakes show decimals (0.3 USDC showed as "0").
  - **Round schedule:** extracted to the pure `eveningRoundPlan` in `lib/time.ts`; the keeper uses it, with the same behaviour as before.
  - **"Our last call":** recorded calls only. Otherwise the cell says "No recorded call yet" or "Record not available on this server". `/api/ledger` now returns `indexed: false` when Redis is missing, instead of `configured: false`.
  - **"Big stocks" and every `useApi` section:** HTTP errors count as failures and retry at 5 s, 15 s and 45 s, then every 2 min. Stocks show "Couldn't load the stocks. Retrying…".
  - **Console:** relative Privy logo (an absolute URL got a 402 while production is down; using `window.origin` caused a hydration mismatch, which I caught and fixed). The WalletConnect icon uses the page origin. The optional Privy import `@farcaster/mini-app-solana` is aliased to nothing in `next.config.mjs`.
  - **Tests:** `npm test` runs `test/*.test.mjs`. New: `round-schedule.test.mjs` (10 cases: weekday, before 20:00, early flag, market open, Friday → Monday, weekend run, Thanksgiving, early close, too close to the lock, EDT and the July holiday) and `round-view.test.mjs` (5 cases, including the regression of a 2-week-old Proposed round). 29/29 pass; `tsc` 0 errors.
  - **Browser check** (headless Chrome against localhost:3000): /app Prices, /app#predict and / have no console errors or exceptions. Predict shows the stale state correctly. The open-round states ("Be the first to call it", "pays 1.32×", "no one on the other side yet", the live comparison) were checked by mocking `/api/predict` in the browser only.
  - **Not fixed (needs owner access):** the keeper itself. Production hosting, the scheduler, the keeper key and finalizing the 12 overdue rounds (Q3, Q4).
- 2026-11-20: Phase 0 investigation (this section). Local dev server: `npm run dev` on :3000.

### 2026-11-21 — Staging live on the owner's personal Railway
- Project `determined-laughter` (personal workspace), service `nightshift`, URL https://nightshift-production-83254d3c.up.railway.app
- Why the first deploy failed: the service was linked to GitHub `main` (old 6 Nov code, 488ea0d) and its build died in `next/font` (Google Fonts returned a reply without a font-file extension to Railway's build server; transient — the same fonts fetch fine from the laptop and the next build).
- Fix: deployed `phase-3-5` from the laptop with `railway up`; set `NIGHTSHIFT_ENV=staging`, `PLAY_TEST_MODE=1` (non-secret). Build + healthcheck passed.
- Smoke: 11 passed, 0 failed, 3 skipped (sign-in, scheduler, email — need `PLAY_SECRET`, `CRON_SECRET`, Upstash, Resend, which the owner enters).
- Open: the service is still connected to GitHub `main` — a push to `main` would redeploy over this. Disconnect or repoint in the dashboard before pushing.
- 2026-11-21: built-in scheduler (`IN_APP_SCHEDULER=1`, commit 1dcecea) deployed to Railway; verified locally (all jobs scheduled, `schedulerPlay: true`). Inactive on Railway until the owner sets `CRON_SECRET`. Waiting on owner: `CRON_SECRET`, `PLAY_SECRET`, Upstash URL/token; then switch to production.
- 2026-11-21: Railway Redis added to `determined-laughter` (owner asked not to use Upstash). App reads it via `REDIS_URL=${{Redis.REDIS_URL}}` (Railway reference; the password never left Railway). New zero-dependency TCP client (commit f859495). Verified on Railway: health `store: redis`, a pick survived a full redeploy. Still waiting on owner: `CRON_SECRET`, `PLAY_SECRET` (they run one command themselves), then switch to production.
