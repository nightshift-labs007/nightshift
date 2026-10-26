# Nightshift Metals: implementation plan

Based on [metals.md](../metals.md). Goal: add silver, then a recurring-buy product ("Stack"), while keeping the site easy for a first-time user.

## Progress

**Decisions (confirmed):** silver first and nothing else; v1 is Fixed SIP only; product name "Stack"; Stack lives inside the App page; the dev owns the legal and Robinhood-eligibility questions.

**Phase 0 results (silver measurements, 26 Oct 2026):**
- Overnight beta to COMEX silver futures: 1.02 (R² 0.96, 20 nights). A strong fit, so the standard model works for silver.
- Worst close-to-open fall on record (since 2006): 15.4% (30 Jan 2026). Gold's worst is 6.0%, so silver gaps about 2.5× harder.
- With Nightshift's night tracking, the average miss at the open falls from 1.53% (frozen price) to 0.43%; the worst miss is 4.3%.
- **LLTV: 62.5%, not the paper's 68%.** 68% is not one of Morpho's enabled LLTVs (38.5, 62.5, 77, 86, …), and the study's frozen-price rule picks 62.5%. Same as IBIT.
- Full data: `public/verified/lltv-study.json` (now includes SLV); reproduce with `node scripts/lltv-study.mjs`.

**Phase 0, DEX versus fair value (26 Oct 2026, Monday early morning ET; `node scripts/dex-gap.mjs`):**
- **The SLV/USDG pool is nearly empty: about $577 of liquidity**, not the $0.2M to $0.7M the research paper quoted. The only meaningful SLV pool is SLV/GLD at about $120K, so a USDG-to-SLV buy would route through GLD (two hops, two fees).
- Over the last ~22 hours (Sunday evening to Monday morning, after the Friday close), the DEX price sat a median 21 to 23 bps from Nightshift's fair value; the 90th percentile was 38 bps (SLV/GLD) and 67 bps (SLV/USDG); the max was 70 bps.
- So the proposed 0.5% (50 bps) max premium would let most installments fill, and the guard would hold some back, as intended. A full weekend (Friday close to Sunday open) still has to be measured: DexPaprika's keyless API only returns 24 hours, so this needs a free API key (7 days) or a few weekends of samples.
- Consequence for Stack: per-installment caps must be small, and a SLV Vault market should wait for real depth. Re-check on-chain before phase 3.

**Silver "global" signal:** the Shanghai/MCX switch is deferred. Neither has free data on Yahoo or Twelve Data, so it would need a paid feed. Silver's global sensitivity is set low (0.1, same as gold), so the effect of leaving it is small.

**Phase 1 done in code (branch `metals-silver`):** SLV added to the Oracle (silver futures anchor, 5% event-mode trigger with the 55 cap at 10%, no sentiment tilt, Twelve Data fallback `XAG/USD`), the paper account (starts with 100 SLV), the faucet list, API v1, Nyx and the docs copy. A live check returned SLV fair value 48.96 vs 48.72 close, confidence 71, beta 1.056.

**Phase 2, contract (done, 27 Oct 2026):** `StackPlan` and a demo pool are live on Base mainnet (demo tokens, no value).
- `StackPlan` `0xfba9ef8a0e3b8dcc5b2b966b0616dd8f1e4e364e`; `StackDemoPool` `0x6a29df50b4fbd9a67b85cf1e378a46bb4ad55a0b` (sells dGLD and dSLV at the Oracle price plus an owner-set spread; seeded with inventory).
- One asset per plan (a "Both" plan is two plans). Guard in the contract: fresh Oracle price (under 1 hour), confidence at or above the plan's floor (75 minimum), and the venue must deliver at least amount / (fair value x (1 + max premium)). Premium caps: GLD 0.5%, SLV 0.75%. Per-run cap 1,000 dUSDG; minimum interval 1 hour on the demo. No fees.
- Skip-and-roll fallback only; cancel is final; every plan has a budget (the most it can ever spend) and an expiry.
- Tests: `node scripts/test-stack.mjs` against a local chain (37 checks: S1 price bound, S2 spend bound, S4 stale or low-confidence Oracle, S5 cancel, S6 allowlist and delivery, windows, skipping, access control). All pass.
- Smoke test on mainnet (`scripts/stack-smoke.mjs`): a team wallet created plan #0 (20 dUSDG of dGLD, hourly); a different wallet executed it; 20 dUSDG bought 0.0544 dGLD at exactly fair value. The plan is still active.
- Boundary note: the price bound is strict and rounds against the buyer, so a fill at exactly +0.50% can miss by one wei; +0.49% fills.
- **Keeper job (done):** the 10-minute keeper now also runs `runStack()`: it simulates each due plan, sends only the ones the guard will accept, and rolls plans whose window closed with `skip()`. Tested on mainnet: a plan created with a 90-second delay was ignored before its window and executed by the keeper after it.
- **Stack tab (done):** App page, second tab beside Borrow (`/app#stack`). Three choices (gold, silver or both; amount; weekly by default), a one-line summary, one button. A "More options" row holds how many buys to stop after. Connected wallets see their plans with next buy, buys so far, amount spent and Pause, Resume and Cancel (cancelling the last plan also removes Stack's permission to spend). A "Get demo dUSDG" button covers new users with no balance. Stack buys, plans and skips appear on the Transactions page.
- **Stack guide (done):** the Stack tab has its own two-step guide, shown once on first visit; the Borrow guide no longer appears on it.
- **Paid-versus-fair (done, partial):** each plan card shows what the wallet actually paid for its buys against Nightshift's fair value and its limit, plus how many scheduled buys were skipped. This is the premium *paid*. The "premium *avoided*" claim (what a naive buy would have cost) still needs recorded DEX prices and the weekend gap data.
- Still open: Lean proofs S1 to S6 and fuzzing, Algorand receipts for fills, premium avoided, and the real Uniswap route on Robinhood Chain.

**Phase 1 on-chain (done, 27 Oct 2026):** dSLV is live on Base mainnet (demo token, no value).
- Token `0xafc5b9d90655353224d6f2f6f81a3ea37153e3fa`, Morpho oracle adapter `0x8c09069f08ac5a57aa308ccd6c65d60dc0b2627d`, price feed `0xb2aa75305d74d9d1d59077d39688dbd9d7d75bd4`.
- Vault market enabled at LLTV 62.5%; the faucet wallet can mint it; first Oracle price written.
- Morpho market `0x84378b5b2384c12cdfaf27dc474b8928fc24cef22485f0b3070694bfc46f8f5a` created, seeded with 1,000,000 dUSDG, and a full loan (supply, borrow, repay, withdraw) ran through it.
- The keeper starts pushing SLV prices once the site deploys with the new `deployment.json`. The Morpho adapter refuses prices older than a day, so that deploy needs to happen soon.
- Scripts: `scripts/deploy-slv.mjs`; `ONLY=SLV EXECUTE=1 node --env-file=.env.local scripts/create-morpho-markets.mjs`. Side effect: a dSPY Morpho market on the post-upgrade adapter was also created by an earlier, aborted run; it is empty and harmless.

**Legal / eligibility (owner: dev):** confirm which countries Robinhood's Stock Tokens are offered in, whether the Robinhood Chain tokens have transfer restrictions, and get counsel's view per launch country. Gates phase 3.

## 1. Principles (the "keep it simple" rules)

1. **One new thing for users: a Stack page with three inputs.** "What" (Gold, Silver, or Both), "How much" ($ per run), "How often" (weekly by default). Everything else has a default and sits under a collapsed "Advanced" row.
2. **Plain words.** "Smart buying" instead of "fair-price guard". "Skipped, price was too high" instead of "confidence floor not met". No LLTV, Permit2 or basis points in the main flow.
3. **Ship the smallest product first.** v1 is Fixed SIP only, for GLD and SLV, with Smart buying always on. The other four plan types (Basket, Step-up, Fair-value boost, Ratio rebalancer) are cut from v1. Basket is just "Both" with a 50/50 split in v1.
4. **No new nav item at first.** Stack lives inside the existing App page as a tab beside Vault, so the nav doesn't grow. Promote it to its own page only if it gets real use.
5. **Show the benefit in one number.** "You saved $X versus buying at the scheduled moment" on the plan card. This is the "premium avoided" figure, and it is what justifies the product.
6. **Safe defaults, no leverage.** Stack never buys with borrowed funds. Guardian stays opt-in.

## 2. What already exists and gets reused

| Need | Reuse | Where |
|---|---|---|
| Add an asset to the Oracle | `PAIRS` list: anchor symbol, beta, LLTV, simulation fallback | `lib/config.ts`, `lib/data.ts`, `lib/oracle.ts` |
| Asset in the Vault | Token, Morpho oracle adapter and Chainlink-style feed deploy pattern used for dGLD | `scripts/deploy-upgrade.mjs`, `scripts/create-morpho-markets.mjs`, `lib/chain/deployment.json` |
| Demo tokens for testing | Faucet and the public per-token hourly `faucet()` | `app/api/drip/route.ts`, `contracts/TestToken.sol` |
| Scheduling | The keeper that already runs every 10 minutes | `app/api/keeper/route.ts`, `lib/chain/keeper.ts` |
| Receipts | Algorand stamping | `lib/algorand.ts` |
| Public record | The Transactions page and activity panel | `lib/transactions.ts` |
| Safety proofs | Lean 4 project and its audit scripts | `formal/`, `scripts/formal.mjs` |

## 3. Phases

### Phase 0: Measure silver before building anything (1 to 2 weeks)

Nothing else should start until these three numbers exist, because they set every threshold.

- SLV overnight beta and R² over 20+ nights against COMEX silver futures (`SI=F`).
- A close-to-open gap study for SLV (same method as the existing four tokens), published on the Docs page.
- The weekend gap between the SLV/GLD DEX price and the Oracle fair value, once the pools can be read.

Also in this phase, in parallel (non-engineering): get a lawyer's view on launch countries, and confirm Robinhood's restricted-country list and whether the Stock Token contracts have transfer restrictions.

**Exit gate:** the gap study supports an SLV LLTV and event-mode threshold; counsel has named at least one clear launch country.

### Phase 1: Silver in the Oracle and Vault (2 weeks, Base demo)

Small, mostly configuration, because the engine is already driven by `PAIRS`.

1. Add SLV to `PAIRS`: anchor `SI=F`, beta from phase 0, LLTV 62.5% from the gap study, simulation fallback, a `NEWS_TILT` entry.
2. Metals signal blend: for metal tokens drop the crypto Fear & Greed signal (renormalise weights) or replace it with an inverse dollar signal. The existing proof that weights stay non-negative and sum to 100% already covers renormalising.
3. Metals-specific event mode: 5% trigger and a cap of 55 at 10% for SLV.
4. Deploy dSLV on Base: token, oracle adapter, feed and Morpho market, following the dGLD pattern. Update `deployment.json` and the faucet's token list.
5. Surface it everywhere the other four tokens appear: Oracle board, API v1 prices, Vault market list, Transactions symbols, docs copy, Nyx knowledge, stocks board.
6. Extend the Guardian fuzzer with silver gap paths and a stale-Oracle path.

**Exit gate:** SLV prices live on-chain for two weeks with sane confidence; fuzzer and Lean checks pass.

### Phase 2: Stack MVP on Base demo assets (4 to 6 weeks)

**Contract: `StackPlan`** (one new contract, per-user plans, no pooled funds).
- v1 plan struct is deliberately small: owner, amount per run, interval, asset (or the two-asset 50/50 flag), next run time, max premium (default 0.5%), min Oracle confidence (default 75), paused flag.
- `createPlan`, `pause`, `resume`, `cancel` (cancel revokes the allowance), and a permissionless `execute(planId)`.
- `execute` reads the Oracle price, refuses if confidence is low or the price is stale (over 1 hour), computes a minimum output from fair value plus the allowed premium, swaps, and sends the metal token straight to the owner in the same transaction. A misbehaving keeper can fail to execute but can never overpay.
- Allowlist of token addresses is fixed in the contract. Users can never supply a token address.
- Spending permission: a capped, expiring allowance. For the demo on Base this is a plain ERC-20 approve for N installments; Permit2 comes with the real-money chain move (phase 3), because the demo tokens are our own.
- Swap venue: on Base demo assets there is no real pool. Phase 2 uses a small test pool seeded by the team (or the Vault's own fixed-price route) purely to exercise the guard. This is called out in the UI as demo liquidity.

**Keeper job.** Extend the 10-minute keeper: list plans whose window is open, simulate `execute`, submit only the ones that pass. A 48-hour window gives about 288 attempts. Skips and failures are logged as events, not errors.

**App: the Stack tab** (this is where "simple" is enforced).
- Empty state: one card, "Buy gold and silver automatically." Three fields (what / how much / how often), a plain-language line below ("Every Monday we buy $20 of gold, only when the price is fair"), and one button.
- Second step: connect wallet and approve once. The approval screen says the maximum it can ever spend and when it expires.
- Plan card: next buy date, total stacked, average cost versus today's price, "saved $X by waiting for a fair price", and Pause / Edit / Cancel.
- Activity feed in plain words: "Bought 0.07 GLD at $366.40", "Skipped: price was 0.9% above fair value, trying again tomorrow".
- Advanced (collapsed): window length, max premium, fallback (skip or buy at cap), "add to Vault as collateral".

**Reuse for the record.** Executions appear on the Transactions page and counts on Transparency. Algorand receipts for fills come in once the flow is stable, not in v1.

**Machine-checked properties** (Lean, in `formal/`): S1 price bound, S2 spend bound, S4 guard gate and S5 cancel for v1. S3 (basket rounding) and S6 (allowlist) follow when Basket and the allowlist registry arrive.

**Exit gate:** a full week of plans filling inside their windows on Base; all four v1 properties proven; plain-language copy tested on five people who have never used the site.

### Phase 3: Real tokens, only after gates (6 weeks plus audit time)

Do not start until all of these are true: an external audit of `StackPlan` is done; counsel has cleared each launch country in writing; geofence and eligibility check are built; a licensed or second price source cross-checks Yahoo/Twelve Data.

- Deploy on Robinhood Chain with real GLD/SLV Stock Tokens. Read token addresses from Robinhood's StockFactory (`Deployed` events), not from lists in documents. The allowlist is set from that.
- Switch spending permission to Permit2, with a capped, expiring signature.
- Real pools: read depth from the Uniswap pools; set per-installment caps and a collateral cap from measured liquidity.
- Geofence: block the app flow in restricted countries and show a plain message ("Not available in your country").
- A Morpho curator conversation for a real GLD/SLV borrow market.

### Phase 4: Later, only if there is demand

Basket and Step-up plans, Fair-value boost, ratio rebalancer, other issuers (xStocks, Ondo), physical-gold tokens as a 24/7 option where Stock Tokens are restricted, session-key permissions if wallets support them.

## 4. Keeping it simple: concrete UI rules

- Default plan is prefilled: Gold, $20, Weekly. A new user can press one button.
- Three words in the main flow replace the jargon: **Buy** (execute), **Skip** (guard held it back), **Saved** (premium avoided).
- Each skip shows its reason in one sentence and what happens next. No raw numbers unless the user opens details.
- Errors tell users what to do ("Add USDG to your wallet", not "allowance insufficient").
- The Stack tab has no Guardian, Cloak or LLTV controls. They appear only after the first buy, as a single optional card: "Borrow against your stack".
- Nyx (the in-site assistant) gets the new knowledge so it can answer "what is Stack?" in two sentences.
- Welcome guide gets one new line, not a new section.

## 5. Risks and decisions needed

| Item | Why it matters | Decision / action |
|---|---|---|
| Legal | Recurring buys of securities tokens may change Nightshift's regulatory position; Stock Tokens are not for US persons; India has a 30% + 1% TDS on this kind of transfer | Counsel before phase 3. Do not make India the launch market. |
| Thin SLV liquidity | Pools of roughly $0.2M to $0.7M | Small per-installment caps ($1,000 for SLV as a start); guard on; collateral cap tied to pool depth |
| Oracle data quality | Free feeds (Yahoo, Twelve Data) become load-bearing once money flows | Add a second source before phase 3 |
| Keeper trust | The keeper can only execute valid fills; the contract enforces the guard | Keep the guard in the contract, not the keeper |
| Demo versus real | Base has demo tokens; real Stock Tokens live on Robinhood Chain | Be explicit in the UI that phase 2 is a demo; do not claim real returns |
| Scope creep | The paper lists five plan types, five assets and a lending loop | Hold to v1: Fixed SIP, GLD + SLV, Smart buying on |

**Decisions for you**
1. Confirm silver first and nothing else (platinum, copper and miners deferred).
2. Confirm v1 = Fixed SIP only.
3. Confirm Stack lives as a tab inside the App page, not a new nav item.
4. Name: "Stack", or something simpler for first-timers (for example "Auto-buy").
5. Who owns counsel and the Robinhood eligibility questions, since they gate phase 3.

## 6. Order of work if you say go

1. Phase 0 silver measurements (script in `scripts/`, same method as `lltv-study.mjs`).
2. Phase 1 `PAIRS` entry and dSLV deployment, since it is mostly config.
3. `StackPlan` contract and tests, then the keeper job, then the Stack tab.
