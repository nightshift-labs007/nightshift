# Nightshift Metals SIP ("Stack"): what was built

27 October 2026. Status of the metals work started from [metals.md](../metals.md). Everything below runs on Base mainnet with **demo tokens that have no value**, and the contracts are unaudited. Test results are in section 6.

## 1. In one paragraph

Nightshift now prices silver as well as gold. It has a working recurring-buy product called **Stack**. A user picks gold, silver or both, an amount and how often. A keeper then buys on schedule, but only when the price is within a small margin of Nightshift's fair value, and the tokens go straight to the user's wallet. The rule against overpaying is enforced by the smart contract itself, not by the server. Stack lives as a second tab on the App page, beside Borrow.

## 2. Decisions taken

| Question | Decision |
|---|---|
| Which metals first | Silver only, added to the gold already priced. Platinum, palladium, copper and miners are deferred. |
| Plan types in v1 | Fixed amount on a fixed schedule only. "Both" is two plans split 50/50. Step-up, fair-value boost and rebalancing are deferred. |
| Product name | Stack |
| Where it lives | A tab on the App page (`/app#stack`), so the navigation didn't grow |
| Where Stack buys on the demo | A small demo pool contract that sells at the Oracle price plus a spread the team sets. To be replaced by a real Uniswap route on Robinhood Chain. |
| Defaults | Max premium over fair value: 0.5% gold, 0.75% silver. Oracle price under 1 hour old. Confidence at least 75. At most 1,000 per buy. Shortest interval 1 hour on the demo (1 day planned for real tokens). |
| Fees | None |
| Legal and Robinhood eligibility | Owned by the dev; gates any real-money launch |

## 3. Silver research (phase 0)

| Measurement | Result |
|---|---|
| Fit to COMEX silver futures overnight | Beta 1.02, R² 0.96 over 20 nights: the standard model works for silver |
| Worst close-to-open fall since 2006 | 15.4% (30 Jan 2026), about 2.5× gold's worst (6.0%) |
| Nightshift's miss at the open vs a frozen price | Average 0.43% vs 1.53%; worst 4.3% |
| Silver loan-to-value (LLTV) | **62.5%**, not the paper's 68%, which Morpho doesn't offer. Same as the bitcoin ETF. |
| Real SLV pool depth on Robinhood Chain | SLV/USDG about **$577**; SLV/GLD about $120K. Much thinner than the paper assumed. |
| DEX price vs fair value (Sun evening to Mon morning) | Median 0.21–0.23%, 90th percentile 0.38–0.67%, worst 0.70% |

What this means: a 0.5% premium limit lets most buys through and holds back the worst, as intended. Silver buys must stay small until real depth exists. A full Friday-to-Sunday weekend is still unmeasured, because the free data source only returns 24 hours.

Scripts: `scripts/lltv-study.mjs` (gap study, output in `public/verified/lltv-study.json`) and `scripts/dex-gap.mjs` (DEX vs fair value).

## 4. What is live

### Silver in the Oracle and the Vault
- **Oracle:** SLV priced from silver futures, with its own event-mode threshold (5%, confidence capped at 55 at 10%) and no crypto-sentiment signal. Shown in the Oracle board, `GET /api/v1/prices/SLV`, the paper account (new accounts start with 100 SLV), the faucet, the news agent and Nyx.
- **On-chain (Base):**
  - dSLV token `0xafc5b9d90655353224d6f2f6f81a3ea37153e3fa`
  - Morpho oracle adapter `0x8c09069f08ac5a57aa308ccd6c65d60dc0b2627d`
  - Price feed `0xb2aa75305d74d9d1d59077d39688dbd9d7d75bd4`
  - Nightshift Vault market at 62.5% LLTV
  - Morpho market `0x84378b5b2384c12cdfaf27dc474b8928fc24cef22485f0b3070694bfc46f8f5a`, seeded with 1,000,000 demo dUSDG; a full loan was run through it
- **Keeper:** pushes the SLV price on-chain with the other four tokens.

### Stack contracts
| Contract | Address | What it does |
|---|---|---|
| `StackPlan` | `0xfba9ef8a0e3b8dcc5b2b966b0616dd8f1e4e364e` | Holds each user's plan and runs one buy when asked |
| `StackDemoPool` | `0x6a29df50b4fbd9a67b85cf1e378a46bb4ad55a0b` | Demo stand-in for a DEX: sells dGLD and dSLV at the Oracle price plus a set spread |

**How a buy works.** Anyone may call `execute(plan)`; normally the keeper does. The contract then:
1. Checks the plan is active, inside its window, under its budget and before its expiry.
2. Reads the Oracle. It refuses if the price is over 1 hour old or the confidence is below the plan's floor.
3. Works out the fewest tokens it will accept: amount ÷ (fair value × (1 + max premium)).
4. Pulls exactly one installment from the user's wallet, buys, and sends the tokens straight back to the user, all in one transaction.
5. Refuses the whole thing if the pool delivers less than the minimum.

So a keeper that misbehaves can only fail to buy. It can never make a user overpay.

**Safety rules built in.** The asset list is fixed by the owner, so users can't pass a look-alike token. Every plan has a budget it can never exceed and an expiry. Cancel is final. The contract holds no funds between buys and resets its allowance to the pool after each buy. There is no fee.

### Keeper
The keeper runs every 10 minutes. For Stack it lists plans whose window is open, simulates each buy, and sends only the ones the contract will accept. Plans whose window closed without a fair price are rolled to the next slot, and the money stays in the user's wallet. It handles at most 12 actions per run, so a backlog can't overrun the time limit.

### The Stack tab (`/app#stack`)
- **Three choices:** what (gold, silver or both), how much (with 10, 20, 50 and 100 shortcuts), how often (weekly by default; daily, monthly and hourly for the demo).
- **A one-line summary:** "Every week we'll buy 20 dUSDG of gold, only when the price is fair."
- **One button:** Start Stack. The wallet asks to approve the total once (it can never spend more), then to confirm each plan.
- **More options:** how many buys before it stops, and an explanation of the fair-price rule.
- **New users:** a "Get demo dUSDG" button when the wallet is empty.
- **Your Stack:** each plan with its status in plain words ("Next buy Tue, Oct 27", "Buying when the price is fair"), buys so far, spent, the most it will spend, and what was paid against fair value. Pause, Resume and Cancel. Cancelling the last plan also removes Stack's permission to spend.
- **Guide:** its own two-step first-visit guide, separate from Borrow's.
- **Elsewhere:** Stack plans, buys and skips appear on the Transactions page (Stack filter) and the Transparency activity panel. Nyx can explain Stack, and the Explore panel mentions it.

## 5. Demo activity so far
- Plan #0: a team demo wallet, 20 dUSDG of dGLD hourly. First buy filled at exactly fair value (0.0544 dGLD for 20 dUSDG), executed by a different wallet.
- Plan #1: another team demo wallet, 20 dUSDG of dSLV hourly. First buy executed automatically by the keeper job (0.411 dSLV).
- Second buys, 27 Oct at about 03:40 (local time): the live keeper on nightshift.buzz executed both plans on its own, with no script involved. Plan #0 paid 368.159 per dGLD and plan #1 paid 48.720 per dSLV, each exactly the Oracle fair value (0 bps premium).
- Both are team wallets, labelled as such on the site. Each has a budget of 100 dUSDG, so at most five buys.

## 6. Testing

| Test | What it covers | Result |
|---|---|---|
| `scripts/test-stack.mjs` (local chain) | 37 checks: price bound, spend bound, stale or unsure Oracle, cancel, allowlist and delivery, windows, skipping, who may do what | **37 / 37 pass** |
| `scripts/fuzz-stack.mjs` (local chain) | Randomised rounds of price, confidence, price age, spread, premium and amount, plus three hostile venues (one lies about what it delivered, one tries to take a double installment, one calls back into `execute`) | **1,610 / 1,610 checks pass** over two seeds (350 random rounds) |
| Mainnet smoke test (`scripts/stack-smoke.mjs`) | A real plan created by one wallet and executed by another | Passed: filled at fair value |
| Keeper on mainnet | A plan due in 90 seconds: ignored before its window, executed after | Passed |
| Deployed keeper, unattended | The live site's scheduled keeper running both plans' next hourly buy with nobody involved | Passed: both bought at fair value, sent by the keeper wallet |
| Live site checks | SLV prices, the App, Transactions, Leaderboard and Transparency pages and APIs | Passed after a fix (below) |
| Typecheck and production build | Whole app | Pass |

**Fuzz results.** Seed 42: 200 rounds (37 filled, 163 correctly refused), 917 checks, all pass. Seed 7: 150 rounds (29 filled, 121 refused), 693 checks, all pass. In every round, a buy went through exactly when the price was fresh, confident and within the premium, and was refused otherwise. No filled buy paid more than fair value × (1 + premium). No run spent more than its amount or its plan's budget. No refused buy moved any money. StackPlan held nothing and left no allowance afterwards. The hostile venues were refused with "price too high" (lying about delivery), "allowance" (taking a double installment) and "reentrant" (calling back into `execute`), and the user lost nothing in each case. Rerun with `node scripts/fuzz-stack.mjs 200 42`.

**Bug found and fixed during testing.** The live `/api/transactions` and `/api/leaderboard` were timing out at Vercel's 30-second limit. One public Base node now serves older history, so a cold request walked eight days of blocks. The history scan now has a time budget: a cold request returns in about 11 seconds and later requests fill in older history. Fixed in commit `9821b08`.

## 7. Known limits

- **Demo only.** Base demo tokens, an unaudited contract, and a demo pool instead of a real market.
- **No "premium avoided" yet.** Plan cards show what was *paid* against fair value. The figure the paper pitches, what a naive buy would have paid, needs real DEX prices, so it comes with the Robinhood Chain version.
- **Short history.** The free Base node limits how far back buy totals and the Transactions page can see. A keyed archive RPC (`BASE_RPC_URL`) would fix it.
- **Browser wallet flow not run end to end.** Starting, pausing and cancelling a plan through the page was checked with a read-only stand-in wallet. The same contract calls succeeded from scripts on mainnet, but the in-page signing still needs one try with a real wallet.
- **No formal proofs yet.** The properties are covered by tests and fuzzing, not by Lean proofs.
- **Cancel and approvals.** Cancelling a plan doesn't revoke the token approval on its own; the page does it when the last plan is cancelled.

## 8. Next steps

1. Try the Stack tab once with a real wallet (start, pause, cancel).
2. Measure a full weekend of SLV and GLD DEX prices against fair value.
3. Legal and Robinhood eligibility (dev), then the Robinhood Chain version: real GLD/SLV, Uniswap routing, Permit2, geofence, audit.
4. "Premium avoided", buy notifications and Algorand receipts.

See [RESEARCH_NEXT_STEPS.md](RESEARCH_NEXT_STEPS.md) for wider ideas, and [METALS_IMPLEMENTATION_PLAN.md](METALS_IMPLEMENTATION_PLAN.md) for the full plan and progress log.

## Files

| Area | Files |
|---|---|
| Contracts | `contracts/StackPlan.sol`, `contracts/StackDemoPool.sol` |
| Deploy and ops scripts | `scripts/deploy-slv.mjs`, `scripts/deploy-stack.mjs`, `scripts/create-morpho-markets.mjs` (`ONLY=SLV`), `scripts/stack-smoke.mjs` |
| Tests | `scripts/test-stack.mjs`, `scripts/fuzz-stack.mjs` |
| Research scripts | `scripts/lltv-study.mjs`, `scripts/dex-gap.mjs` |
| Keeper | `lib/chain/keeper.ts` (`runStack`), `app/api/keeper/route.ts` |
| Site | `components/StackTab.tsx`, `components/Pages.tsx`, `components/WelcomeGuide.tsx`, `components/Transactions.tsx`, `lib/transactions.ts` |
| Silver | `lib/config.ts`, `lib/oracle.ts`, `lib/data.ts`, `lib/chain/deployment.json` |
