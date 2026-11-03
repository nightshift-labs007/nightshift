# Plan: Nightshift Prediction Market ("Call the Open")

> **Status (4 Nov 2026): built and live on Base Sepolia.**
> - Contract: [`NightshiftPredictions` `0xb2aa75…5bd4`](https://sepolia.basescan.org/address/0xb2aa75305d74d9d1d59077d39688dbd9d7d75bd4), 48/48 tests (`scripts/test-predictions.mjs`), source on Sourcify.
> - Keeper: `lib/chain/predictions.ts`, run from `/api/keeper` (member sync, the 20:00 ET evening call on Algorand plus round creation, propose/finalize after the open).
> - Page: the **Predict** tab at `/app#predict`. APIs: `/api/predict`, `/api/predict/me`.
> - Settles by propose-and-challenge; the Pyth path is built in and off until there's a Pyth API key.
> - Not yet built: alerts, leaderboard points, Nyx intents, the evening-vs-morning stat (section 5 and P4).

Every trading day, Nightshift locks its predicted opening price for each tokenized ETF on Algorand. This feature lets registered users bet, on-chain on Base, whether the real opening price will come in **higher or lower than Nightshift's call**.

> "SPY: Nightshift says it opens at **$757.97**. Will it open **Higher** or **Lower**?"

---

## 1. What existing prediction markets do (and what we take from each)

| Platform | How it works | What we borrow | What we skip |
|---|---|---|---|
| **PancakeSwap Prediction** (BNB, Arbitrum) | Rolling rounds: bet **Up** or **Down**. Winners split the pot pro rata (parimutuel). Chainlink sets the lock and close prices. The treasury takes 3%. If the oracle fails, the round is cancelled and bets are refunded. | **The closest model to ours.** Rounds, two pools, pro-rata payout, claim after settle, refund on oracle failure. | "Tie = house wins" and "one-sided round goes to treasury": unfair, so we refund instead |
| **Polymarket** | Each outcome is a share worth $1 if right, traded on an order book (CLOB). Resolution goes through UMA's optimistic oracle: anyone proposes the result, and it can be disputed. | The **propose → challenge window → final** resolution as a backup path. Plain-English rules for every market. | An order book: it needs market makers and many traders to work |
| **Kalshi** | Regulated (CFTC) daily markets like "S&P 500 above X at close". | Clear **resolution source and timestamp** written into every market. Legal caution. | — |
| **Limitless** (on Base) | Short-term price markets on crypto and stocks, CLOB, resolved on-chain using Pyth prices. | Proof that **price markets on Base resolved by an oracle** work. Pyth as the resolution source. | CLOB |
| **Thales / Overtime** | Binary "above/below strike" options priced by an AMM. | The "above/below a strike" framing | An AMM needs a liquidity provider who can lose money |

**Decision: a parimutuel pool, like PancakeSwap, with three Nightshift twists:**
1. The strike is **Nightshift's own locked call**, so every round is also a public test of our engine.
2. **Time-weighted shares**, so people who bet late with better information can't drain the early bettors (section 3.3).
3. **Refunds instead of a "house wins"** on ties and one-sided rounds.

Why parimutuel:
- No liquidity provider or market maker is needed, and Nightshift never takes the other side of a bet.
- The odds show live as pools fill.
- It's simple to audit and works with a small user base.
- Order books need volume we don't have yet.

---

## 2. The game, in plain words

1. **A round opens** for each ETF (SPY, QQQ, GLD, SLV, IBIT) as soon as Nightshift locks its call for the next open.
2. **Users pick Higher or Lower** and stake test tokens (tUSDG on Base Sepolia).
3. **Betting closes** 30 minutes before the 09:30 ET open.
4. **At the open** the real opening price is recorded:
   - Opens **above** the call → **Higher** wins.
   - Opens **below** the call → **Lower** wins.
   - **Exactly equal** → everyone is refunded.
5. **Winners split the whole pool**, minus a fee (0% on testnet), in proportion to their weighted stake. They claim with one transaction.
6. **Refunds** happen if:
   - the round has bets on only one side,
   - the result is a tie,
   - the oracle can't settle within 24 hours, or
   - the market doesn't open (holiday, halt).

---

## 3. Key design decisions

### 3.1 The strike: add an evening call (important)

Today's call is stamped on Algorand by the `/api/commit` cron at 12:00 UTC: about 07:00 ET in winter and 08:00 ET in summer, and it often lands ~45 min later. That leaves **only 15–75 minutes of betting**, and right before the open, when futures already give most of the answer away.

**Change:** add an **evening call**, locked at **20:00 ET** after the close, as the strike.
- Betting then runs **20:00 ET → 09:00 ET**: 13 hours overnight, which fits the whole "Nightshift" idea.
- The call is genuinely uncertain at that point, so the game is fair and fun.
- Nightshift's evening miss vs the morning miss becomes a new public stat on the transparency page.
- The existing morning stamp stays as it is for the track record.
- The evening stamp uses the same Algorand format with a new note prefix `nightshift:eve:v1:`, plus a Base transaction that creates the round with the same strike and the Algorand tx hash.

**Weekends and holidays:** the Friday 20:00 call is for Monday's open, so betting runs all weekend. That's the most exciting round of the week.

### 3.2 Resolution: who decides the real opening price

Nightshift both makes the call and would report the result, which is a **conflict of interest**. We remove it in layers:

| Layer | How | When |
|---|---|---|
| **A. Pyth on-chain (trustless)** | Anyone calls `resolve(round, pythUpdateData)`. The contract checks a signed Pyth price for that ETF with a publish time in `[09:30:00, 09:31:00]` ET, using `parsePriceFeedUpdates` with a time window. | **If Pyth publishes these ETF feeds on Base.** Check feed IDs for SPY/QQQ/GLD/SLV/IBIT on Base first (task P0). |
| **B. Optimistic (Polymarket/UMA style)** | The keeper proposes the opening price with a source link and a bond. A **2-hour challenge window** follows, during which any registered user can dispute with a bond. A dispute goes to a **multisig arbiter**. With no dispute, the result is final. | Fallback when Pyth isn't available or is stale |
| **C. Cancel** | Not settled within 24h → full refunds | Always available |

**Pyth check (done 4 Nov 2026):**

| Question | Result |
|---|---|
| Does Pyth price all five ETFs? | **Yes.** `Equity.US.SPY/USD` `19e09bb8…1cd5`, `Equity.US.QQQ/USD` `9695e2b9…452d`, `Equity.US.GLD/USD` `e190f467…fecca`, `Equity.US.SLV/USD` `6fc08c99…e7e7`, `Equity.US.IBIT/USD` `9db6bc1e…48f5`. Regular hours only, 09:30–16:00 ET, which is exactly the window we need. |
| Is the Pyth contract on Base Sepolia? | **Yes**, at `0xA2aa501b19aff244D90cc15a4Cf739D2725B5729`, live (`getValidTimePeriod` = 60s). |
| Can we read ETF prices there today? | Only stale ones (SPY from July 2026; none for SLV). Pyth is a *pull* oracle: whoever settles a round must submit a fresh signed update in the same transaction. That's expected and fine. |
| Can we get those signed updates for free? | **No, not any more.** Since Pyth's Core upgrade (31 July 2026), Hermes, its price server, returns **401 unauthorized** without an **API key**. That covers both the latest prices and the price at a past second such as 09:30:00. Pyth offers a free trial, then paid plans. |

**Decision:** for the testnet launch, **propose-and-challenge (B) is the main way rounds settle**. It's free and works today:
- The keeper proposes the official NYSE open, which our data feed already records.
- Anyone has 2 hours to challenge it.
- Every proposal is also checked against the Nightshift ledger's actual open, so a wrong proposal is easy to spot.

The contract ships with `resolveWithPyth` already built in. Path A switches on when we add a Pyth API key: the keeper fetches the signed 09:30 update from the upgraded Hermes (`pyth.dourolabs.app/hermes`, Bearer key) and settles trustlessly. Before switching, compare Pyth's first price after 09:30:00 with the official opening-auction price for a week. They can differ slightly, and the rules must name exactly one.

**The resolution rule is printed on every round:** "Opening price = the official NYSE opening price of {TOKEN}, proposed on-chain after the open and final if not challenged within 2 hours. Disputes are decided by the Nightshift multisig." (With a Pyth key, this becomes: "the first Pyth price for {TOKEN} published at or after 09:30:00 ET".)

### 3.3 Fairness against late, informed bets

Close to the open, futures make the answer more obvious, and our own site shows the live fair value. In a plain parimutuel, late bettors pile onto the obvious side and dilute everyone who bet early. Fixes:

- **Time-weighted shares:** `shares = stake × w(t)`, where `w` falls linearly from **1.00** when the round opens to **0.50** at close. An early, braver call earns up to 2× the payout per token. (Used by several on-chain pools; simple and transparent.)
- **Close at 09:00 ET**, 30 minutes before the open.
- **Caps:** at most 1,000 tUSDG per bet and 5,000 per wallet per round, so no single whale decides the odds.
- The UI shows **current payout multipliers** for Higher and Lower before you bet.

### 3.4 Only registered users can bet, enforced on-chain

The UI gate (`MemberGate`) isn't enough, because anyone can call a contract directly. Options:

| Option | How | Pros / cons |
|---|---|---|
| **Allow-list in the contract (recommended)** | `setMembers(address[], bool)` callable by a **registrar** role. The keeper syncs every 5 min: it reads the `members` hash from Redis and writes new or removed wallets in one batch. | Simple and cheap on Base (one tx per batch). Revocable. Deleting a profile removes it. |
| Signed pass (EIP-712) | The server signs `{wallet, expiry}` and the contract checks the signature on each bet | No sync job, but more complex. Passes can't be revoked before they expire. |

### 3.5 Money: testnet only, play tokens (decided 4 Nov 2026)

- **Stake token:** tUSDG on Base Sepolia, already given free by `/api/drip`. Registered users get a weekly top-up.
- **No real money.** Betting with real value is regulated or banned in many places:
  - **United States:** event contracts are regulated by the CFTC.
  - **India:** real-money online games are banned under the 2025 Online Gaming Act.
  - Elsewhere it's often treated as gambling.
- So: **tokens with no value, no cash-out, nothing to buy.** Winnings show up as points and on the leaderboard.
- Any real-money version needs a legal opinion first, the same gate as lending Stage B.

---

## 4. Smart contract: `NightshiftPredictions.sol` (Base Sepolia)

### 4.1 State

```solidity
struct Round {
  bytes32 token;            // "SPY"
  uint32  session;          // 20261104 (target open, New York date)
  uint64  strike;           // Nightshift's call, 8 decimals
  uint64  openTime;         // betting opens
  uint64  lockTime;         // betting closes (09:00 ET)
  uint64  marketOpen;       // 09:30 ET, unix
  bytes32 algorandTx;       // the Algorand stamp that holds the same strike
  uint128 higherShares; uint128 lowerShares;   // time-weighted
  uint128 higherStake;  uint128 lowerStake;    // raw tokens
  uint64  openPrice;        // result, 8 decimals
  Status  status;           // Open, Locked, Proposed, Settled, Cancelled
  Outcome outcome;          // None, Higher, Lower, Refund
  uint64  proposedAt; address proposer; // optimistic path
}
mapping(uint256 => Round) rounds;
mapping(uint256 => mapping(address => Position)) positions; // side, stake, shares, claimed
mapping(address => bool) isMember;
```

### 4.2 Functions

| Function | Who | Does |
|---|---|---|
| `createRound(token, session, strike, openTime, lockTime, marketOpen, algorandTx)` | keeper (`creator` role) | Opens a round; one per token per session |
| `bet(roundId, side, amount)` | registered wallet | Checks `isMember`, the round is open, `now < lockTime` and the caps. Pulls tUSDG and adds `amount × w(now)` shares. One side per wallet per round, but bets can be added to. |
| `resolveWithPyth(roundId, updateData)` | anyone | Path A: verifies the Pyth price at the open window and settles |
| `propose(roundId, openPrice)` + `dispute(roundId)` + `finalize(roundId)` | keeper / members / anyone | Path B: optimistic with a 2h challenge window; disputes go to the arbiter |
| `arbitrate(roundId, openPrice or cancel)` | multisig arbiter | Decides disputed rounds only |
| `cancel(roundId)` | anyone, after `marketOpen + 24h` if unsettled; arbiter any time | Refund mode |
| `claim(roundIds[])` | bettor | Pays winners `pool × myShares / winningShares` minus the fee. Refunds the stake in Refund mode. Several rounds in one transaction. |
| `setMembers`, `setCaps`, `setFee`, `pause` | registrar / owner (Safe multisig) | Admin |

### 4.3 Settlement rules (identical in code, the docs and the UI)

- `openPrice > strike` → Higher; `openPrice < strike` → Lower; equal → Refund.
- Either side has zero stake → Refund.
- Fee: `feeBps` (0 on testnet, capped at 300 in code) taken from the losing pool only, so winners never get back less than they staked.
- Rounding: integer division in favour of the contract. Leftover dust goes to the treasury after 30 days.

### 4.4 Safety

- Reentrancy guard; checks-effects-interactions; pull payments (claim) only.
- No admin function can move user funds, except the arbiter choosing an outcome or a refund for disputed rounds.
- Events for everything: `RoundCreated`, `Bet`, `Proposed`, `Disputed`, `Settled`, `Cancelled`, `Claimed`. The UI and the leaderboard index these.

---

## 5. Off-chain pieces (reuse what exists)

| Piece | Change |
|---|---|
| **Evening call** (`/api/commit-evening`, new) | At 20:00 ET each trading day: compute fair value for the next session, stamp it on Algorand (`lib/algorand.ts`), then `createRound` on Base for each token with the same strike and the Algorand tx id. Triggered from the 5-min keeper (`app/api/keeper`), since the Vercel free plan allows only daily crons. Idempotent: skips if the round exists. |
| **Resolver** (inside `/api/keeper`) | From 09:31 ET: fetch the Pyth update for the open window and call `resolveWithPyth`. If Pyth is unavailable, `propose` the official open from our data feed. At +2h with no dispute, `finalize`. |
| **Member sync** (inside `/api/keeper`) | Compare Redis `members` with the on-chain allow-list and send one `setMembers` batch. |
| **Indexer** (`lib/predictions.ts`) | Read rounds, pools and the user's positions with viem multicall, cached 30s. Past results come from `Settled` events. |
| **API** | `GET /api/predict` (current and recent rounds, pools, multipliers), `GET /api/predict/me?address=` (positions, claimable) |
| **Alerts** (ties into the alerts plan) | "Round open: SPY call $757.97", "Betting closes in 30 min", "You won 42 tUSDG, claim now" |
| **Leaderboard** | New stats: predictions made, win rate, net tUSDG. Points: +2 per round played, +3 per win (no value). |
| **Nyx** | "What's Nightshift's call for SPY?", "Bet higher on QQQ" opens the page pre-filled; Nyx never signs. |

---

## 6. The page: `/predict` (a "Predict" tab in the App)

**Top:** the next open countdown ("Betting closes in 3h 12m · opens Tue 09:30 ET"), with a one-line rule: "Bet whether each ETF opens higher or lower than Nightshift's locked call."

**One card per ETF:**
```
SPY · S&P 500 ETF                          Locked on Algorand ↗
Nightshift's call for Tue open:   $757.97
Fair value right now:             $758.40  (+0.06% vs call)
──────────────────────────────────────────────
 HIGHER  1.8×   pool 4,210        LOWER  2.2×   pool 3,400
 [ Higher ]                       [ Lower ]
 Amount [ 50 tUSDG ]  Max     Your share weight now: 0.82
──────────────────────────────────────────────
Your bet: 50 on Higher · potential payout 91 tUSDG
```

- **Not registered:** cards are visible but the buttons say "Finish sign-up to play" (reuses `MemberGate`).
- **No wallet:** "Connect wallet". **Wrong network:** "Switch to Base Sepolia".
- **No tUSDG:** a "Get test funds" button (existing faucet).
- **After lock:** "Waiting for the open". **After settle:** "Opened at $759.45 · **Higher** won", with Claim and the payout.
- **History tab:** past rounds with the call, the open, the winner, and our miss. **My bets tab:** everything you've played, claimable winnings, "Claim all".
- Every card shows the full rules link and the resolution source.

Transactions are approve tUSDG once (exact amount or a capped allowance), then `bet`, using the existing wallet flow (`lib/wallet.tsx`, viem).

---

## 7. Tests and verification

- **Contract tests** (`scripts/test-predictions.mjs` on Hardhat, same style as `test-stack.mjs`):
  - create, bet both sides, lock, settle Higher, Lower, tie, one-sided;
  - cancel after 24h;
  - claim twice reverts; a non-member reverts; a bet after lock reverts; caps;
  - dispute flow; pause.
- **Fuzz** (`scripts/fuzz-predictions.mjs`): random bets and timings. Invariants:
  - total paid out ≤ total staked;
  - every winner gets back ≥ their stake when the fee is 0;
  - refunds return exact stakes.
- **Formal (Lean via Aristotle, same pipeline):** prove payout conservation and "the winner's payout is ≥ stake when feeBps applies to the losing pool only".
- **End to end:** a full overnight round on Base Sepolia with demo wallets (like `scripts/demo-activity.mjs`).
- **Audit:** in scope with the lending audit before any real-money version.

---

## 8. Build order and timeline (~3 weeks)

| Phase | Work | Time |
|---|---|---|
| **P0: checks** | ~~Confirm Pyth feeds on Base Sepolia~~ **Done:** feeds and contract exist; signed updates need an API key, so v1 settles by propose-and-challenge. **Done:** test tokens only (tUSDG, no value, no cash-out). Remaining: settle the rules text. | 1 day |
| **P1: contract** | `NightshiftPredictions.sol`, tests, fuzz, deploy to Base Sepolia, verify on Sourcify, add to `deployment.json` | 5 days |
| **P2: keeper** | Evening call + round creation, resolver (Pyth, then optimistic), member sync | 3 days |
| **P3: page** | `/predict` tab, cards, bet flow, claim, history, My bets, Nyx intents | 4 days |
| **P4: polish** | Alerts, leaderboard points, transparency stat (evening vs morning miss), docs page, a week of dry-run rounds with demo wallets | 3 days |

**Done when:** for 5 trading days in a row, rounds open at 20:00 ET, close at 09:00 ET and settle within 5 minutes of the open from Pyth (or optimistically within 2h) with no manual step, and every claim pays exactly what the UI promised.

---

## 9. Risks and answers

| Risk | Answer |
|---|---|
| Nightshift resolves its own market | Pyth on-chain resolution; optimistic fallback with public disputes; every strike pre-committed on Algorand |
| Late bettors with better information | Evening strike, close at 09:00 ET, time-weighted shares, caps |
| Sybil wallets | Invite code + verified email + on-chain allow-list; per-wallet caps |
| Oracle outage, holiday, halt | Auto-refund after 24h; no round is created for holidays (NYSE calendar already in `lib/time.ts`) |
| Legal (gambling / event contracts) | Testnet tokens with no value, no cash-out; legal opinion before anything real |
| Keeper key compromise | Keeper can only create rounds and propose; the arbiter is a Safe multisig; the optimistic window lets anyone dispute |

---

## Sources

- [PancakeSwap Prediction FAQ](https://docs.pancakeswap.finance/french/products/prediction/prediction-faq)
- [PancakeSwap Prediction on Arbitrum (Chainlink Data Streams)](https://blog.pancakeswap.finance/articles/o-que-e-pancake-swap)
- [PancakeSwap: AI Prediction](https://docs.pancakeswap.finance/play/prediction/ai-prediction)
- [Limitless on Base guide (DappRadar)](https://dappradar.com/blog/the-ultimate-guide-to-defi-prediction-markets-with-limitless-on-base)
- [How Luno's Prediction Markets work (Limitless-powered, Pyth resolution)](https://guide.luno.com/hc/en-gb/articles/33407164922013-How-Luno-s-Prediction-Markets-work)
- [How Limitless works (pm.wiki)](https://pm.wiki/ar/learn/how-limitless-works)
- [Pyth: using prices on EVM](https://docs.pyth.network/price-feeds/pro/use-prices-on-blockchain/evm)
- [Pyth forum: US equity feeds stale on Base](https://dev-forum.pyth.network/t/price-feeds-for-us-equity-are-not-been-updated-periodically/375)
- [Pyth Core upgrade: every Core user needs an API key (31 July 2026)](https://docs.pyth.network/price-feeds/core/upgrade/preparing)
- [Pyth API key and access tokens](https://docs.pyth.network/api-reference/authentication/token)
- [Pyth forum: historical prices need Pyth Pro](https://dev-forum.pyth.network/t/cant-fetch-historical-prices-with-pyth-terminal-api/809)
