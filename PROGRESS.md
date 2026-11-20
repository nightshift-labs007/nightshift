# Nightshift: progress log

A running log of decisions, finished work and open questions, so any new session can pick up from here.
Newest entries go at the top of each section.

## Current phase

**Phase 1 (Fix what's broken): done 2026-11-20 on branch `phase-1-fixes`, waiting for "go" on Phase 2.**
Phase 2 touches settlement and possibly contracts, so it starts with a design for approval.

## Decisions

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

- **Q6 (new, Phase 1): the X agent posts replay numbers as performance.** `lib/xagent.ts:135` and `lib/xmix.ts:73` post "off by X%" from the shift-report replay (futures at the open). It only runs on production, so it's dormant while hosting is down. Before production comes back, it should post only recorded calls, or label replays clearly. Not changed yet because it's outward-facing and can't be tested without X keys.
- **Q7 (new):** `npm test` needs Node ≥ 22.6 (`--experimental-strip-types`), but `package.json` says `engines.node >= 20`. Fine locally (Node 22.14). Either bump `engines` or keep tests on 22+ only.
- Q1 and Q2 are answered (see Decisions, 2026-11-20 Phase 2 design input).
- **Q1 (Phase 2, important): the answer is visible before the lock.** NVDA, AAPL, TSLA and SPY trade after hours (16:00–20:00), overnight (Blue Ocean / 24-hour brokers) and in pre-market, and their tokens trade 24/7. With "up or down vs last close" locked at 04:00 ET, the overnight price usually already shows the answer. People pile onto the obvious side, payouts fall toward 1.0×, and one-sided pools refund. Options: (a) lock at the 16:00 close, so the pick window is the trading day before; (b) keep time-weighted shares and close earlier; (c) compare against a reference price at lock time instead of the last close. Needs a decision before Phase 2.
- **Q2:** The fifth headline asset. Tentative suggestion: Gold (GLD). It isn't tech, it's driven by macro and geopolitics, and it's popular with users in India. Bitcoin is weak here because it trades 24/7 in plain view.
- **Q3:** Who restores production hosting (the Vercel account owner) and the outside scheduler for `/api/keeper`?
- **Q4:** What happens to the 12 Proposed rounds on mainnet? They have no stakes. Finalizing them needs the keeper key (owner action).
- **Q5:** Earlier ideas from 2026-11-20 not yet scheduled: blind call (user picks before seeing the AI), and crowd calls blended into the public signal (never into lending prices).

## Done

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
