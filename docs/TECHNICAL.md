# Nightshift — Technical Overview

For: developers joining the project. Status as of 11 Oct 2026.
Companion to `Nightshift_Concept_Paper.pdf`. Section 7 maps each paper claim to the code and to a test you can run.

---

## 0. Testnet build (Oct 2026)

`contracts/` holds TestToken (faucet ERC-20s), NightshiftOracle (+ MorphoOracleAdapter, Morpho `IOracle` shape), NightshiftVault (deposit/borrow/repay/withdraw, confidence-haircut limits, Morpho LIF liquidation, opt-in on-chain Guardian `protect()`), and the snarkjs-exported Groth16 verifier. `npm run contracts:compile` builds them; `scripts/test-contracts.mjs` runs 15 end-to-end checks on a local chain; `scripts/deploy-contracts.mjs` deploys to Base Sepolia. `/api/keeper` pushes Oracle prices on-chain and runs the Guardian; `/api/drip` gives visitors test gas and tokens; `/api/chain` reports on-chain state. Signal weights are re-fit from the last ~20 opens (`lib/weights.ts`); the optional Claude news agent (`lib/news.ts`) adds a fifth signal. Go-live steps: `docs/TESTNET.md`.

## 1. What the product does

Nightshift is an off-hours price oracle and lending stack for tokenized ETFs (SPY, QQQ, GLD, IBIT) on Robinhood Chain.

| Module | Job | State today |
|---|---|---|
| Oracle | Fair value + confidence for each ETF token, 24/7 | **Live** (public market data) |
| Vault | Borrow USDG against ETF tokens, limits set from the Oracle | **Smart contracts built and tested** (Base Sepolia, Morpho Blue rules) + paper mode |
| Guardian | Watches each loan; alerts or auto-repays before liquidation | **On-chain** `protect()` + server keeper; paper mode in browser |
| Cloak | Zero-knowledge proof that a hidden loan is solvent at the Oracle price | **Live** (real Groth16 proofs, server + on-chain verifier) |
| Ledger | Stamps each pre-open prediction on Algorand | **Built, off** until a TestNet key is configured |

The landing-page copy was changed from "Use AI to fight AI" to what the system demonstrably does: price after hours, lend against that price, protect loans, prove solvency privately, record predictions.

---

## 2. Architecture

One Next.js 15 app (App Router, TypeScript). The server side is API routes; there is no database.

```
Yahoo Finance ─┐
alternative.me ┴─► lib/data.ts ─► lib/oracle.ts ─► /api/oracle, /api/oracle/[token]
                                     │                 │
                                     ├► lib/backtest.ts ─► /api/shift-report
                                     ├► lib/series.ts ──► /api/series
                                     ├► /api/zk/verify (price check for proofs)
                                     └► /api/commit (cron) ─► Algorand TestNet ─► /api/ledger

Browser: components/* render the page; lib/paper.ts holds the paper account (localStorage)
and runs the Guardian on every Oracle refresh; public/zk/* proves in the browser.
```

| Path | Purpose |
|---|---|
| `lib/config.ts` | Assets, anchors, LLTVs, signal weights |
| `lib/data.ts` | Market data fetch, session timing, simulation fallback |
| `lib/oracle.ts` | Signal models → fair value + confidence |
| `lib/backtest.ts` | Shift report (predicted vs. actual opens) |
| `lib/series.ts` | Fair-value history for the chart |
| `lib/paper.ts` | Paper Vault account + Guardian rule engine |
| `lib/algorand.ts` | Stamp / read predictions on Algorand |
| `zk/solvency.circom` | Cloak circuit |
| `public/zk/` | Compiled circuit, proving key, verification key, snarkjs |
| `components/` | UI: `Hero`, `HiveCanvas`, `OracleBoard`, `OracleChart`, `ApiPanel`, `VaultApp`, `GuardianConsole`, `Cloak`, `Ledger`, `TechStack` |

---

## 3. Modules

### 3.1 Oracle

**Data sources:** Yahoo Finance public chart endpoint (no key) for:
- ETF daily bars: official close and its 16:00 ET timestamp.
- Hourly and 5-minute anchors: `ES=F` → SPY, `NQ=F` → QQQ, `GC=F` → GLD, `BTC-USD` → IBIT.
- `^N225`, `^GDAXI`, `^FTSE` for Asia and Europe.

The Crypto Fear & Greed index comes from alternative.me (today and yesterday).

**Signal models** (`lib/oracle.ts`). `C` = last official close, `a` = anchor move since that close.

| Signal | Estimate | Weight |
|---|---|---|
| Anchor | `C · (1 + β·a)`, β = 1 | 0.6 |
| Global | `C · (1 + s·g)`, g = mean Asia/Europe move since close; s = 0.5 / 0.55 / 0.1 / 0.3 | 0.2 |
| Momentum | `Anchor · (1 + 0.25 · 3h anchor trend)` | 0.1 |
| Sentiment | `Anchor · (1 + tilt · ΔF&G / 50)`; tilt = 0.2% / 0.3% / −0.1% / 0.8% | 0.1 (0 if the feed is down) |

- **Fair value** = weighted mean of the four estimates.
- **Confidence** = `clamp(98 − 0.3·hoursSinceClose − 0.5·dispersionBps − 10·simulated, 35, 98)`. During the regular session the fair value is the live ETF price and confidence is 99.

**Not machine learning.** The weights are fixed priors. The paper's "weights learned from track record" is not built yet (see §6).

**Fallback:** if a feed fails, that asset uses a deterministic simulation and every response is labelled `"source": "simulated"`.

**Track record** (`lib/backtest.ts`): for each of the last 10 sessions, it predicts the 09:30 open from the previous close and the anchor price at 09:00–09:30, using no later data, then compares against the real open and against a frozen-close feed. On 10 Oct 2026, SPY averaged 6.0 bps of error vs. 33.9 bps for the frozen feed (9/10 mornings won).

### 3.2 Vault (paper trading)

`lib/paper.ts`, `components/VaultApp.tsx`. The account lives in the browser's localStorage under `nightshift.paper.v1`.

- **Starting wallet:** 10 SPY, 10 QQQ, 20 GLD, 200 IBIT, 0 USDG.
- **LLTV:** 77% (SPY, QQQ, GLD), 62.5% (IBIT). These are Morpho Blue's enabled LLTV tiers.
- **Health factor:** `units · price · LLTV / debt`, where price = Oracle fair value.
- **Nightshift borrow limit:** `units · min(fair, frozenClose) · LLTV · (1 − (100 − confidence) / 200)`. Opening also requires HF ≥ 1.05.
- **Actions:** open, borrow, repay, add collateral, withdraw (must keep HF ≥ 1.10), close (repay all).
- **Liquidation (Morpho Blue):** when HF < 1, collateral worth `debt · LIF` is seized, with `LIF = min(1.15, 1 / (0.3·LLTV + 0.7))`, about 7.4% at 77% LLTV.

### 3.3 Guardian (paper trading)

`guardianTick()` in `lib/paper.ts` runs on every Oracle refresh (60 s) while the page is open. It can also be triggered by "Run check now". Per loan:

- **Off:** nothing (liquidation still applies).
- **Alert:** if HF < trigger, an alert, rate-limited to one per 30 minutes per loan. It appears as a toast, in the activity feed, and as a browser notification if permitted.
- **Auto-protect:** if HF < trigger, it sells `k` collateral at `P·(1 − 0.5%)` and repays, so HF returns to the target:
  `k = (P·u·L − T·D) / (P·(L − T·(1 − s)))`. The target is forced to be ≥ trigger + 0.05.

The shock test previews the same logic at a hypothetical gap without changing state. The "Weekend walkthrough" is the scripted Friday → Monday scenario.

**Limitation:** it only runs while a browser tab is open. Section 6 covers the server-side keeper.

### 3.4 Cloak (live zero-knowledge proofs)

- **Circuit:** `zk/solvency.circom`, 918 constraints, Circom 2.1.6, circomlib Poseidon / comparators / bitify.
  - Public inputs: `priceCents`, `lltvBps`.
  - Private inputs: `units` (1e-4 units), `debtCents`, `salt`.
  - Output: `commitment`.
  - Proves `units · price · lltv > debt · 1e8` (HF > 1), plus range checks (64/64/40/14 bits) so nothing wraps the field, and `commitment = Poseidon(units, debtCents, salt)`.
- **Proof system:** Groth16 over BN254 (snarkjs 0.7.6). Proofs are ≈ 720 bytes; proving takes ≈ 0.3–0.8 s in the browser and verifying ≈ 10–300 ms on the server.
- **Trusted setup:** phase 1 is the PSE Perpetual Powers of Tau (`ppot_0080_12.ptau`, 80 contributions); phase 2 is a single demo contribution. Production needs a multi-party phase 2.
- **Verification** (`/api/zk/verify`) checks three things:
  1. The proof is valid.
  2. The proven price is within 0.5% of the live Oracle.
  3. The LLTV matches the market.

  Check 2 matters: a valid proof alone only says "solvent at the price the prover chose".
- **UI:** prove an example position or one of your Vault positions, tamper test, copy proof, and a standalone "Verify a shared proof" box.
- **Rebuild:** `npm run zk:build`. This is only needed if the circuit changes; the compiled artifacts are committed.

### 3.5 Ledger (Algorand TestNet)

- **Schedule:** Vercel Cron calls `/api/commit` at 12:00 UTC on weekdays. It's guarded by `Authorization: Bearer $CRON_SECRET`.
- **Payload:** `{session, at, p: {token: fair}, c: {token: confidence}}` plus its SHA-256.
- **Transaction:** written as the note of a 0-ALGO self-payment, prefix `nightshift:v1:`, via algosdk 3 and AlgoNode.
- **Reading:** `/api/ledger` reads the account's notes from the indexer and joins each with the actual open. The chain is the store.
- **To enable:** set `ALGORAND_MNEMONIC` (funded TestNet account; `npm run algo:account` creates one) and `CRON_SECRET` in Vercel.

---

## 4. Public API

All routes are `GET`, JSON, CORS `*`, and need no key.

| Route | Returns |
|---|---|
| `/api/oracle` | Market status and all quotes (fair value, confidence, drift, per-signal estimates) |
| `/api/oracle/{TOKEN}` | One quote |
| `/api/series?token=SPY&range=1H\|4H\|12H\|24H` | Fair-value history (5-minute data) |
| `/api/shift-report` | Last 10 sessions: predicted vs. actual open, error vs. frozen feed |
| `/api/ledger` | Stamped predictions with outcomes (once configured) |
| `POST /api/zk/verify` | Body `{token, proof, publicSignals}` → validity + Oracle/LLTV checks |

---

## 5. Run, build, deploy

```
npm install
npm run dev            # http://localhost:3000
npm run build
npx vercel --prod      # deploy from local, no GitHub needed (see README)
```

- **Environment variables** (only needed for the Ledger): `ALGORAND_MNEMONIC`, `CRON_SECRET`.
- **Hosting:** fits Vercel's free Hobby tier.
- `NEXT_DIST_DIR` can point a second build at another folder, so verification builds don't collide with `next dev`.

---

## 6. From paper to production (proposed)

| Step | Work | Notes |
|---|---|---|
| Oracle v2 | Learn signal weights from the shift-report history; add a news unit | Needs persisted history (the Ledger already provides it) |
| Oracle on-chain | Push fair value to an on-chain price contract (Morpho `IOracle`: `price()` scaled 1e36) | Push on a schedule plus a deviation threshold; multiple signers |
| Vault | Create Morpho Blue markets: ETF token collateral, USDG loan, Nightshift oracle, AdaptiveCurveIRM, LLTV 77% / 62.5% | Start on a testnet with mock tokens; confirm Morpho Blue is deployed on Robinhood Chain |
| Wallets | wagmi/viem wallet connection; replace `lib/paper.ts` actions with contract calls | Same UI |
| Guardian | Server-side keeper and pre-approved actions (Morpho authorization / bundler) | Users sign a scoped permission once |
| Cloak | Export a Solidity verifier (`snarkjs zkey export solidityverifier`); multi-party phase-2 ceremony; auditor view-key | Private positions need a shielded design, not just proofs |
| Ledger | Mainnet account; also stamp proof hashes | |

---

## 7. White paper claims → code → how to check

| Paper claim | Where | Check |
|---|---|---|
| Fair value + confidence when markets are closed | `lib/oracle.ts` | `GET /api/oracle` on a weekend: `marketOpen:false`, agents populated |
| Weighted multi-signal estimate | `lib/oracle.ts`, `lib/config.ts` | Response lists all 4 signals with weights summing to 1 |
| Public morning shift report | `lib/backtest.ts` | `GET /api/shift-report`: Nightshift error < frozen-feed error |
| Predictions locked before the open | `app/api/commit`, `lib/algorand.ts` | After enabling: a tx on lora.algokit.io with a `nightshift:v1:` note before 13:30 UTC |
| Lending on Morpho with Oracle-set limits | `lib/paper.ts` | Open a position; Nightshift limit ≤ frozen limit; HF matches the formula |
| Guardian protects before liquidation | `guardianTick` | Set the trigger above the current HF → Run check → alert, or auto-protect raises HF to the target |
| ZK: prove a loan is backed without revealing it | `zk/solvency.circom`, `/api/zk/verify` | Generate proof → ACCEPT; Tamper → REJECT; an under-collateralized input can't produce a proof |
| Separate permanent record on Algorand | `lib/algorand.ts` | `GET /api/ledger` |
| Privacy for positions (full) | — | **Not built.** Proofs only; positions are not hidden on-chain yet |
| Weights learn from track record | — | **Not built.** Weights are fixed priors |

**Automated end-to-end check used during development:** a headless Chrome run that opens a position, repays, triggers an alert and an auto-protect, proves the position, verifies a pasted proof, rejects a forged one, and closes the position. It reports no console errors.

---

## 8. Open questions for the team

1. **Network:** is Morpho Blue (or a fork) available on Robinhood Chain testnet? If not, which EVM testnet do we demo on?
2. **USDG:** confirm the loan asset and whether a testnet USDG exists, or we deploy a mock.
3. **Oracle signers:** one operator key for the demo, or a multi-signer set from day one?
4. **Guardian permissions:** what exactly may the keeper do without a fresh signature (repay only, or also sell collateral)? What are the limits per action?
5. **Cloak scope:** proofs of solvency only for launch, or shielded positions? The latter is a much larger build.
6. **Data licensing:** Yahoo's endpoint is unofficial. Which paid feed (e.g. CME futures, a crypto index) do we use for production?
7. **Legal:** wording and geo-restrictions for Stock Tokens (not available to US persons); "data, not advice" placement.

## Earn panel (Sentora, Phase 1: read-only)

`GET /api/earn/sentora` → `{ vault, apy7d, apy30d, apyReported, tvl, sharePrice, coverActive, history, source, updatedAt, dataAt, stale, depositUrl }`, cached 10 min (`s-maxage=600`). Code: `lib/earn/sentora.ts`, UI: `components/Earn.tsx`.

- **APY** = `(P_now / P_then)^(365/d) − 1` on the vault share price, for d = 7 (headline) and 30 days. The daily share-price history comes from DefiLlama's yields API (`/chart/{pool}`), so no snapshot database is needed.
- **On-chain read**: when `SENTORA_VAULT_ADDRESS` is set, the current share price (`convertToAssets(1 share)`) and TVL (`totalAssets()`) are read from the ERC-4626 vault on Ethereum mainnet (`ETH_RPC_URL`, default a public RPC).
- **Stale**: if the last good read is over an hour old, `stale: true` and the panel shows a warning.
- **Deposit link**: opens Sentora in a new tab with `utm_source=nightshift&utm_medium=earn_panel&utm_campaign=sentora_phase1`. Nightshift never touches funds.

Environment variables (all optional):

| Variable | Default | Purpose |
|---|---|---|
| `SENTORA_LLAMA_POOL` | `64d85231-…` (Sentora PRIME, PYUSD, Ethereum) | DefiLlama pool for history/APY/TVL |
| `SENTORA_VAULT_NAME` | `Sentora PRIME` | Name shown on the panel |
| `SENTORA_VAULT_ADDRESS` | unset | Vault contract for on-chain reads |
| `SENTORA_VAULT_CONFIRMED` | `false` | `true` removes the "pending confirmation" label |
| `SENTORA_FIRELIGHT_COVER` | `false` | `true` shows the Firelight cover badge (only once Sentora confirms) |
| `SENTORA_DEPOSIT_URL` | `https://vaults.sentora.com/` | Deep link target (UTM tags are added) |
| `SENTORA_APY_7D` | `8.9` | Sentora's published 7-day APY, shown as the headline with its date (`off` = use the on-chain calculation) |
| `SENTORA_APY_AS_OF` | `2026-10-12` | Date of that published figure |
| `ETH_RPC_URL` | public RPC | Ethereum mainnet RPC (Alchemy/Infura recommended) |
