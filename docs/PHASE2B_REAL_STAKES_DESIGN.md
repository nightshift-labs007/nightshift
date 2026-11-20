# Phase 2B: real-stakes "up or down vs last close" (design only)

Status: **design for a decision. No contract code has been written.** Written 2026-11-20.

## 1. What we want

The real-USDC version of the points game (Phase 2A), with the same rules wherever money allows:

| | Points mode (2A, built) | Real stakes (2B, this design) |
|---|---|---|
| Question | Will each asset open above or below its close? | Same |
| Assets | NVDA, AAPL, TSLA, SPY, GLD | Same (on-chain token ids) |
| Lock | The 16:00 ET close (13:00 on early-close days) | Same |
| Settle | The next trading day's 09:30 ET open; Friday covers the weekend; holidays skipped | Same |
| Flat | Same cent → push, no points | Same cent → refund |
| Payout | Fixed points | Parimutuel pool, time-weighted shares, small fee, refund if one-sided |
| Caps | none | Small, as today (10 USDC per prediction, 25 per wallet per round) |

## 2. Why the deployed contract can't do this

`NightshiftPredictions` (Base mainnet `0xb8eb03…64ea`, not upgradeable: plain constructor, no proxy) was built for "higher or lower than Nightshift's call":

- `createRounds` requires a **strike > 0 at creation** and `lockTime > now`. Our strike is the **official close**, which doesn't exist until the lock. So a round would have to be created before its strike is known.
- `_settle` compares `openPrice` with the stored `strike` at full 8-decimal precision. Our flat rule compares at the **cent**.
- `resolveWithPyth` only checks a price at the open, not a close.

Any version of 2B therefore means a **new contract deployment** (a v2), not a configuration change.

## 3. Options for setting the strike after the lock

### Option A: set the strike in a second step
Rounds are created with no strike. After the close and before the open, the operator calls `setStrike(id, close)`, which gets its own challenge window. If no strike is set by the open, the round refunds.
- **For:** the official close is on-chain before the result is known, which is good for transparency.
- **Against:** two keeper transactions and two dispute windows per round, more states, more ways to get stuck.

### Option B: propose the close and the open together, after the open (recommended)
Rounds are created with no strike. After the open, the operator calls `propose(id, close, open)`. One challenge window covers both prices. The outcome is the open vs the close, compared at the cent.
- **For:** the smallest change from today's tested flow (propose → challenge → finalize). One transaction and one window. The close is public market data anyway, so nobody gains from seeing it on-chain earlier.
- **Against:** the strike only appears on-chain after the open. Still fully trusting the proposer, unless someone disputes.

### Option C: verified oracle prices (Pyth pull, later Chainlink)
Anyone settles by submitting signed Pyth updates published in `[close, close+60s]` and `[open, open+60s]`. The contract checks the signatures.
- **For:** no trust in Nightshift for settlement.
- **Against:** needs a paid Pyth API key since Pyth's July 2026 upgrade. Pyth's price at 16:00:00 is **not** the official closing-auction price, so the rules would have to say "Pyth's price at 16:00 ET" and real stakes would settle differently from points mode (Yahoo). Equity feeds cover regular hours only. Chainlink Data Streams are paid as well.

### Option D: propose only the outcome (UMA style)
The operator proposes "up / down / flat" with no prices.
- **For:** the simplest contract.
- **Against:** the least checkable, since nothing on-chain shows what the outcome was based on. Not recommended.

**Recommendation:** **B now**, keeping C's interface so a Pyth proof can later replace the proposal for the same round. Every proposal includes the data source, and the page shows it next to Yahoo's numbers so anyone can check before the window closes.

## 4. Other changes v2 needs (whichever option)

1. **Cent comparison in the contract.** Store prices with 8 decimals but decide on `price / 1e6` (cents), so on-chain and points mode agree on flats.
2. **Lock at the close.** `lockTime` = the close (16:00 or 13:00 ET), `openTime` = the previous lock, `marketOpen` = the next session's 09:30 ET. The keeper computes these with `playRoundFor()` (already tested in 2A).
3. **Fix the cancel/finalize race (found while answering "can users withdraw without the keeper?", see §5.1).** An undisputed proposal can only be **finalized**. `cancel` is allowed only for rounds never proposed (`Open` and `now ≥ marketOpen + cancelAfter`), or for disputed rounds the arbiter hasn't decided within a set timeout.
4. **Bound `cancelAfter` from above** (for example ≤ 3 days), so the owner can't push refunds out indefinitely.
5. **Dispute bond.** Today any registered wallet can dispute for free, which forces the arbiter to act on every dispute. Require a small bond that's returned if the dispute is upheld.
6. **SafeERC20** for USDC transfers, and a test that a USDC-blacklisted winner only blocks their own claim.
7. **Ownership and roles in a Safe multisig** (owner and arbiter). Today the owner is one wallet.
8. **Events for the close and the open,** so indexers and the page can show both.

## 5. Risks

### 5.1 Getting money out when the keeper is down (today's contract)
**Yes, a user can withdraw without the keeper**, but not easily:
- `finalize(id)` is permissionless once an undisputed proposal's 2-hour window has passed. After that, winners `claim`.
- `cancel(id)` is permissionless once a round is 24 hours past its open and still `Open` or `Proposed`. After that, everyone `claim`s a full refund.
- `claim` isn't blocked by `pause` (only new bets are).

The problems:
- **No UI path.** Users would have to call `finalize`, `cancel` and `claim` on Basescan and pay gas in ETH. Users of Privy email wallets can't realistically do that.
- **The race:** after 24 hours, an undisputed proposal can be either finalized (winners paid) or cancelled (everyone refunded). Whoever calls first decides, so a losing bettor can cancel a round they lost. While the keeper is down, nobody finalizes in time.
- **The owner can raise `cancelAfter`** without an upper limit (`setLimits` only enforces a minimum), which would delay refunds indefinitely.

### 5.2 Other risks
| Risk | Notes / mitigation |
|---|---|
| **Legal: real-money predictions on stock prices** | Likely treated as event contracts, binary options or gambling in many places (US: CFTC/SEC; India: the 2025 Online Gaming Act bans real-money online games). **Needs legal review before launch.** Stock tokens aren't offered to US persons, which adds geofencing questions. I make no legal claims here. |
| **Insider information** | Single stocks (NVDA, AAPL, TSLA) move on after-close earnings. Someone with material non-public information could bet on the gap. Possible mitigations: skip earnings nights, or index/commodity only (SPY, GLD) for real stakes. Legal question. |
| **Resolver trust (option B)** | Nightshift proposes both prices. Mitigations: public source, challenge window, bond, multisig arbiter, later Pyth (C). |
| **Data source** | Yahoo is unofficial, rate-limited (we hit HTTP 429 repeatedly on 2026-11-20) and may change without notice. Its consolidated close can differ from the primary exchange's closing auction by a few cents. Rules must name exactly one source. For real money, a licensed feed is better. |
| **Keeper liveness** | Rounds settle only when the keeper runs (production was down 6–20 Nov). Needs §4.3 plus a UI for finalize, cancel and claim, plus monitoring. |
| **Thin pools** | Most rounds today have no stakes; one-sided pools refund. Not dangerous, but discouraging. Points mode should build the audience first. |
| **Time-weighted shares with a close lock** | The strike is the close, so late bettors don't know the answer, only more of the day's path. Weighting rewards early bets without much informational reason. Kept, as decided; could be revisited. |
| **Lock-time ordering** | Base's sequencer orders transactions; `block.timestamp` near 16:00:00 can differ by seconds. The lock is enforced on-chain (`< lockTime`), and nobody knows the overnight gap at 16:00, so a few seconds don't matter much. |
| **Sybils** | Caps are per wallet. Many wallets get around them. The member allow-list (invite + email) limits this, at the cost of friction. |
| **Owner key** | A single EOA can change limits, fees and the arbiter. Move to a Safe before real volume. |

## 6. Testnet plan (before any mainnet change)

1. A v2 contract on **Base Sepolia** with test USDC (Circle's Sepolia USDC or our tUSDG).
2. Hardhat unit tests for every path: create, bet, lock, propose (close, open), dispute with a bond, arbitrate, finalize, cancel only where allowed, claim, flat at the cent, one-sided, pause, caps, fee.
3. Fuzz (random bets and timings). Invariants: total paid out ≤ total staked; refunds return exact stakes; a winner gets back ≥ their stake when the fee is 0; no path lets a losing bettor force a refund on an undisputed result.
4. Formal: extend the Lean payout-conservation proofs to v2.
5. Fork test on Base mainnet with real USDC (as done for v1).
6. **Dry run of 10 trading days** with demo wallets. It must include a weekend, a holiday or early close (Thanksgiving week is ideal), a flat, a one-sided pool, a dispute, and a deliberately stopped keeper (the cancel and claim path through the UI).
7. Pages for finalize, cancel and claim, so nobody needs Basescan.

## 7. What needs an external audit

- **Before real stakes go beyond today's caps:**
  - the v2 contract: betting, the payout and rounding maths, propose/dispute/arbitrate/finalize/cancel, the Pyth path if included, pause, access control, fee accounting and the USDC integration;
  - the ownership and multisig setup.
- **Should also be reviewed:**
  - the keeper's resolver code (which prices it proposes and from where);
  - key management for the operator key;
  - member sync.
- **Before the audit:** internal review, Slither, the fuzz and formal results above.

## 8. Decisions needed from you

1. Option **B** (recommended), A or C for settlement.
2. Which assets get real stakes: all 5, or SPY and GLD only (the insider-information risk above)?
3. Keep the member allow-list (invite + email) for real stakes?
4. Fee level and caps for v2.
5. Legal review: who, and when.
