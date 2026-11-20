# Nightshift: progress log

A running log of decisions, finished work and open questions, so any new session can pick up from here.
Newest entries go at the top of each section.

## Current phase

**Phase 2 (2A built, 2B designed): done 2026-11-20 on branch `phase-2a-points` (stacked on `phase-1-fixes`), waiting for "go" and the 2B decisions.**
Nothing is merged or pushed. No contracts, funds or secrets were touched.

## Decisions

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

- **2B decisions (see `docs/PHASE2B_REAL_STAKES_DESIGN.md` §8):** settlement option (B recommended), which assets get real stakes, keep the member allow-list, fee and caps, legal review.
- **Q8 (new): Yahoo is a fragile source.** It returned HTTP 429 on both hosts for most of 2026-11-20, partly because the dev server polls it too. The points game copes (retries, 20 s budget, void after 72 h), but a licensed feed, or Twelve Data as a keyed fallback, should come before real money.
- **Q9 (new):** points-game progress lives in one browser cookie. Clearing cookies loses it. Phase 3 should let a player save it to an account (email via Privy).
- **Q10 (new):** "Beat the AI" (the 20:00 ET evening mode, points only) isn't built yet. Phase 3 or later?
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
