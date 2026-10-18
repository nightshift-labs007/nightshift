# Nightshift: how we answered the reviewer questions

*Status as of October 15, 2026. Every number below comes from the live site (nightshift.buzz), the contracts on Base, or a script in this repository that anyone can re-run.*

Nightshift is an **unaudited demo**. The Vault and markets on Base use demo tokens with no value. This document says
plainly where something is finished, where it's still partial, and what it is measured against.

## Summary

| # | Question | Status |
|---|---|---|
| 1 | Fair-value model in production | ✅ Live |
| 2 | Beta estimation and Blume adjustment | ✅ Live |
| 3 | Public API, Chainlink-style and Morpho feeds | ✅ Live |
| 4 | Weekends, holidays, overnight news | ✅ Live |
| 5 | Which properties are proven, and are the proofs public? | ✅ Live, public repo |
| 6 | Independent audit? | 🟡 Audit scope ready; no audit yet |
| 7 | Guardian proofs and adversarial testing | ✅ Proven and fuzzed |
| 8 | Real Morpho Blue market? | 🟡 Morpho-compatible oracles are live; market creation script ready, not yet run |
| 9 | How the keeper works and how it fails | ✅ Live and documented |
| 10 | LLTVs, and how they compare with Morpho stock markets | ✅ Historical study published |
| 11 | What a Cloak proof attests, and who verifies it | ✅ Server and on-chain |

The full answers, with live tables, are at **nightshift.buzz/docs**.

---

## Oracle and pricing

### 1. How the fair-value model works in production

**What we built**
- **Data:**
  - Yahoo Finance is the primary source.
  - **Twelve Data** is a second, independent source that takes over automatically when Yahoo is blocked or returns too little data.
  - If both fail, the price is labelled *simulated*, and confidence drops by 10 points.
- **Model:**
  - Each ETF is priced overnight from four signals:
    - its futures anchor: ES (SPY), NQ (QQQ), gold (GLD) and bitcoin (IBIT)
    - Asia and Europe index moves
    - the 3-hour anchor trend
    - the Fear & Greed index
  - The weights are learned from past opens. They are proven never to be negative and always to sum to 100%.
- **Updates:**
  - A keeper pushes fair value and confidence to the on-chain Oracle **every 10 minutes**, scheduled on cron-job.org with a daily Vercel cron as a backup.
  - Any single update that moves a price more than 15% is skipped on-chain; only the owner can force it through.
- **When the futures data is thin:**
  - If the anchor has no fresh bar for 2 hours while it should be trading, confidence is capped at **60**.
  - A foreign market with no data for 4 days drops out of the blend.

**How well it works now**

| Asset | Average miss at the open, Nightshift | Average miss, frozen last close | Nightshift closer |
|---|---|---|---|
| SPY | 0.05% | 0.31% | 9 of 10 opens |
| QQQ | 0.08% | 0.60% | 9 of 10 |
| GLD | 0.23% | 0.80% | 9 of 10 |
| IBIT | 0.21% | 1.22% | 9 of 10 |

This table is a backtest over the last 10 opens: beta is measured only from earlier nights, and futures are read at the open itself.

The stricter test is the **out-of-sample ledger**. Each weekday at about 08:46 ET, roughly 45 minutes before the open, the prediction is hashed and written to Algorand, so it can't be edited afterwards:

| Sessions locked on Algorand | Predictions | Nightshift closer than frozen | Average miss, Nightshift | Average miss, frozen |
|---|---|---|---|---|
| Oct 12–14, 2026 | 12 | **9 of 12** | 0.38% | 0.57% |

On Oct 14 the market fell after the 08:46 lock, and the locked SPY and QQQ calls were worse than a frozen price. The
ledger shows its losing days too. Three sessions is too few to draw conclusions, so the ledger keeps growing every
weekday and each entry can be checked on Algorand TestNet.

### 2. Beta estimation and the Blume adjustment

**What we built** (`lib/beta.ts`, live in the oracle and the API)
- **Measured beta:** an ordinary least-squares fit of the ETF's overnight move (previous close to open) against the anchor's move over the same night.
- **Blume adjustment:** `0.67 × β + 0.33`, which pulls a short-window estimate toward 1. The result is clamped to 0.5–1.5.
- **Recalculated on every price update**, using **only earlier sessions**, so there's no look-ahead.
- **Low-quality fits:**
  - Fewer than 10 nights falls back to β = 1.0, labelled "few sessions".
  - **R² below 0.3** falls back to β = 1.0, labelled "low R²".
  - The API shows the raw beta, R², the number of nights and any fallback, so consumers can see when the estimate is weak.

**How well it works now:** SPY's beta is 0.977 (raw 0.966, R² 0.98, 21 nights). The live table is on /docs#beta and in `/api/v1/prices`.

### 3. Public API and on-chain feeds

**What we built**
- **REST API (`/api/v1`):**
  - `/prices` and `/prices/{token}`: fair value, confidence, beta, every signal, and the on-chain feed addresses.
  - `/history`: the fair-value series.
  - `/track-record`: predicted against actual opens.
  - Limited to 60 uncached requests per minute per IP; responses are cached for 60 seconds.
- **Chainlink-style feeds on Base (`NightshiftAggregatorV3`):** the standard `latestRoundData()` interface with 8 decimals, plus `confidence()`. Any protocol that reads Chainlink can read these.
- **Morpho Blue oracles on Base (`MorphoOracleAdapter`):** the `price()` interface at Morpho's 1e36 scale. They **revert on a price more than a day old**, so a Morpho market can't lend or liquidate on a stale number.

| Asset | Chainlink-style feed | Morpho oracle |
|---|---|---|
| dSPY | `0xe48aecf355d5cd22665ec6f7aa6767ca9a9f2e6b` | `0x0c0b7d5d8bc355449b405a95b0c9340ddab0aea7` |
| dQQQ | `0xd59903410ad53fdeedd678775ff0a1a76e9f0aaa` | `0x58b906b7ed814ca0908324e5aae666b09b827d5b` |
| dGLD | `0x3f18b88a652b4148af88dc9f739080ac91245bcb` | `0x7f1c89ab95facabb360695480beeafbb30706645` |
| dIBIT | `0x146c622c99d5a1bbd89df2af3939861eef13946e` | `0x5118e7e20ac6ab2429695a45d584025e8054c0b7` |

**How well it works now:** all feeds are live and read correctly on Base; for example, dSPY reads 769.12 through both interfaces. On-chain prices are under 10 minutes old. All 10 new contracts are exact matches on **Sourcify**.

### 4. Weekends, holidays and overnight news

**What we built**
- **NYSE calendar:** every holiday and early close is in the code (`lib/time.ts`). A holiday counts as one long night, not as a session.
- **Confidence falls with time closed:** each hour the market is shut lowers confidence by 0.3 points.
- **Event mode:** when fair value moves sharply while the market is shut, confidence is capped:

| Asset | Move that triggers it | Cap at the threshold | Cap at 2× the threshold |
|---|---|---|---|
| SPY, GLD | 3% | 70 | 55 |
| QQQ | 3.5% | 70 | 55 |
| IBIT | 7% | 70 | 55 |

  A lower confidence shrinks how much anyone can borrow.
- **On-chain fallback if updates stop:** the Vault lowers confidence by 1 point per hour by itself, stops new borrowing below 40, and refuses a price older than 2 days.

**How well it works now**
- The LLTV study (question 10) measured every close-to-open gap since 2005, including weekends and holidays.
- Over the last two years, the jump left at the open with Nightshift tracking the night was about **3–6× smaller** than with a frozen price. For example, SPY's average went from 0.42% to 0.09%, and its worst from −3.99% to −1.35%.

---

## Formal verification and security

### 5. Which properties are proven, and are the proofs public?

**What we built:** **24 properties** are machine-proven in Lean 4 with Mathlib and checked by Harmonic's Aristotle. The proofs are public at **github.com/nightshift-labs007/nightshift-formal**, where automated checks rebuild every proof on each change; they currently pass 24 of 24.

| Group | Properties |
|---|---|
| Vault (V0–V7) | A healthy loan can't be liquidated. Health rises with price and collateral, and falls with debt. Rounding favours the protocol. The liquidation bonus is at most 15%. Borrowing within the limit is healthy *at that price*. |
| Guardian (G1–G5) | The sale is at least 0 and at most your collateral. It reaches your target in exact math. It is the smallest sale that does. There is no sale when selling can't help. It only acts on loans that can still be saved. |
| Oracle (O1–O3) | Fair value stays between the lowest and highest signal. Weights are never negative and sum to 100%, including learned ones. With the same signals, more hours closed means lower confidence. More disagreement means lower confidence. Confidence always stays between 35 and 98. |
| Cloak (C1–C4) | The circuit's numbers can't overflow, field arithmetic equals normal arithmetic for Nightshift's ranges, and rounding is conservative. |

**Also fixed:** we checked every automated X post against what its proof actually states. Three overclaimed, and they've been corrected:
- **V7** now says "healthy at that price", not "always safe".
- **O2** is now "with the same signals", not "never".
- **G3** is now "exact in the math, within a hair on-chain".

### 6. Independent audit

**Status: not audited yet.** The contracts are labelled an unaudited demo everywhere.

**What we did instead, and in preparation**
- **Slither** (Trail of Bits' static analyzer, 102 detectors) found 2 real issues: the Morpho adapter accepted stale prices, and `repay`/`liquidate` updated state after token transfers. **Both are fixed and deployed.** Every other finding is explained in `/verified/security/slither.json`.
- **An audit scope and threat model** (`docs/AUDIT_SCOPE.md`, also at `/verified/audit-scope.md`) is ready to send to audit firms. It covers the scope (about 520 lines), roles and key risks, the invariants to check, known design issues and a production checklist. It states openly that today one owner wallet can force-set prices.
- **Next:** quotes from audit firms. The audit is the gate before any real asset.

### 7. Guardian: what's proven, and adversarial testing

**What's proven** (G1–G5 above): the sale is never negative, never more than your collateral, lands exactly on your target in exact math, and is the smallest sale that gets there. When selling can't save the loan, the Guardian doesn't sell and alerts instead.

**Adversarial testing** (`scripts/fuzz-guardian.mjs`): the real Vault contract was driven through random crash, gap and recovery price paths with random loan sizes, LLTVs, triggers and targets. After every move, each rule was checked against what the contract actually did.

| Price moves | Invariant violations |
|---|---|
| **34,708** | **0** |

Full results: `/verified/guardian-fuzz.json`.

---

## Vault, Guardian and lending

### 8. Real Morpho Blue market?

**What's live**
- The Vault is Nightshift's own contract, following Morpho Blue's rules: health factor, LLTV, and the liquidation incentive `min(1.15, 1/(0.3·LLTV + 0.7))`.
- The **Morpho-compatible oracles are live on Base** (question 3). They were tested against the real Morpho Blue contract on a fork of Base:
  - The market was created.
  - Borrowing up to the limit worked, and one unit more was refused.
  - A 20% price drop made the loan liquidatable.

**What's ready but not yet run:** `scripts/create-morpho-markets.mjs` creates real Morpho Blue markets on Base for dSPY, dQQQ, dGLD and dIBIT against dUSDG. Morpho has confirmed that our interest-rate model and both LLTVs are enabled. The script then funds each market and runs one full loan on-chain: deposit, borrow, repay, withdraw. Morpho markets have no owner. It needs one approval to run, and its results will appear on /docs automatically.

**Path:**
1. Demo markets on Morpho Blue.
2. Independent audit.
3. A market with a licensed tokenized-ETF as collateral and a real loan asset, listed by a Morpho curator.

### 9. How the keeper works

- **Trigger:** a borrower opts in with a trigger and a target health factor, for example 1.10 and 1.40. Their own rule is the only thing the keeper can act on.
- **Frequency:** every 10 minutes (cron-job.org), plus a daily backup run.
- **Action:**
  - When health is below the trigger and above 1, the keeper calls `protect()`. This sells *just enough* collateral to reach the target; the formula is proven in G3 and G3b.
  - If selling can't help, it alerts in the app instead. The contract enforces the same rule, as proven in G4.
- **Gas:** default Base pricing, with transaction order set explicitly. Each keeper wallet holds about 0.0008–0.002 ETH, enough for hundreds of actions at Base fees.
- **Failure modes:**
  - **Keeper offline:** nobody rebalances. Below health 1, anyone can liquidate, as on Morpho.
  - **Rescue impossible:** the contract refuses and the app alerts.
  - **Price updates stop:** on-chain confidence decays, borrowing stops below 40, and the price is refused after 2 days.
  - Every state-changing function has a re-entry guard. A test with a malicious callback token confirms re-entry is refused.

**How well it works now:** `/api/health` reports no problems. Keeper, updater and faucet wallets are funded, and all four on-chain prices are under 10 minutes old.

### 10. LLTVs, and how they compare with Morpho stock markets

**Current settings:** LLTV is 77% for SPY, QQQ and GLD, and 62.5% for IBIT. The borrow limit is also cut when confidence is low.

**The study** (`scripts/lltv-study.mjs`; results on /docs#lltv and in `/verified/lltv-study.json`):
- **Bad-debt line:** a loan at its LLTV leaves bad debt only if the price falls more than `1 − LLTV × LIF` in one jump that no liquidator can act inside. The jump at the market open is that move.
- **Data:** every close-to-open gap since 2005, about 5,500 nights per ETF; IBIT since its 2024 listing.

| Asset | Worst fall at the open (frozen price) | Bad-debt line at current LLTV | Safe with a 1.5× margin? |
|---|---|---|---|
| SPY | −10.5% (Mar 16, 2020) | 17.3% at 77% | ✅ yes |
| QQQ | −9.5% (Mar 16, 2020) | 17.3% at 77% | ✅ yes; 0 breaches in 20 years |
| GLD | −6.0% (Jan 30, 2026) | 17.3% at 77% | ✅ yes; 86% would also pass |
| IBIT | −20.4% (Aug 5, 2024) | 29.6% at 62.5% | ⚠️ inside the line, but without the 1.5× margin |

**What it means**
- SPY, QQQ and GLD at 77% would survive every gap in 20 years even if the oracle froze.
- IBIT at 62.5% is only safe while Nightshift is tracking bitcoin overnight. It is the first market to lower if updates ever stop.
- Nightshift's tracking would justify much higher LLTVs, but two years of data is too short to lend against, so the frozen-price result sets the limit.

**Compared with live Morpho markets** (from Morpho's public API):
- Tokenized-stock markets mostly use **62.5%**: the Robinhood-token markets for NVDA, SPY, AAPL, GOOGL and TSLA.
- Some use **86%** (xStocks SPYx on Ethereum), and some **38.5%**.
- Nightshift's 77% for broad index and gold ETFs sits in between, backed by the gap history above.

---

## Cloak (ZK solvency proofs)

### 11. What a Cloak proof attests, and who verifies it

**What it proves:**
- A Groth16 proof (918 constraints) that `debt × 10⁸ < units × price × LLTV`, meaning the loan's **health is above 1 at the stated price and LLTV**.
- It reveals neither the collateral amount nor the debt, and outputs a commitment to the hidden numbers.
- It does not prove a specific health factor such as 1.4, only that the loan is solvent.

**Who verifies it:** both the server and a contract.

| Where | Checks |
|---|---|
| **Server** | The proof is valid. Its price matches the live Oracle within 0.5%. Its LLTV matches the market. |
| **On-chain (`CloakRegistry` on Base, new)** | The Groth16 verifier contract checks the math. The price must match the on-chain Oracle within 1%, from a price less than a day old. The LLTV must match the Vault's market. `attest()` records a passing proof on-chain. |

**Tests:** proofs with a made-up 2× price, a different LLTV, or tampered values are all refused. So is any attempt to record a refused proof. The proven properties are C1–C4.

---

## What changed on Base (October 15, 2026)

| Contract | Address | Sourcify |
|---|---|---|
| NightshiftVault (upgraded) | `0x2aae4bcf7eec8cc842bacfcf9e13a54cba649071` | exact match |
| CloakRegistry (new) | `0xe3a3cd6ce59a3c5e9d5449189d58a90d1ca04341` | exact match |
| 4 Morpho oracles and 4 Chainlink-style feeds (new) | listed under question 3 | exact match |
| NightshiftOracle (unchanged) | `0x5507ad4cba6bfe88e0702f703fffc05fa7d3a66e` | verified |

The total deploy cost was about 0.000034 ETH.

## Still open

1. **An independent audit:** the scope is ready; we need quotes and funding.
2. **Morpho Blue demo markets:** the script is ready; it needs one approval to run.
3. **A longer out-of-sample record:** the Algorand ledger adds about 4 predictions every weekday. We'll report it again at 30 sessions.
4. **Production hardening** (listed in the audit scope): a multisig and timelock on owner powers, a second independent price updater, a borrow pause, and Guardian sales routed to a DEX.

## Re-run any of this yourself

```bash
node scripts/test-phase2-contracts.mjs   # 19 contract tests, including adversarial ones
node scripts/fuzz-guardian.mjs           # Guardian fuzzing on random price paths
node scripts/lltv-study.mjs              # gap study behind the LLTVs
curl https://nightshift.buzz/api/v1/prices
curl https://nightshift.buzz/api/v1/track-record
curl https://nightshift.buzz/api/ledger  # out-of-sample predictions locked on Algorand
```
