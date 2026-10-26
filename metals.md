# Nightshift Metals: Research Paper on Adding Gold, Silver & Metal ETF SIPs

Oct 25, 2026 · @ARES

## Executive summary

Recommendation: build **Nightshift Stack**, a non-custodial recurring-buy (SIP) product for tokenized gold and silver ETFs on Robinhood Chain, where every installment is executed only at a price the Nightshift Oracle considers fair. Gold is already half-done: the Oracle prices GLD today. Silver (SLV) is the one new asset worth adding first; platinum, palladium, copper and miners come later and only if issuers list them.

The differentiator is not "a DCA button" (many protocols have one). It is a **fair-value-guarded SIP**: Nightshift's after-hours price stops a user's weekly buy from paying a weekend or overnight premium on a thin DEX pool, then the accumulated stack can flow straight into the existing Vault, Guardian and Cloak.

- **What exists to buy:** Robinhood Stock Tokens for GLD and SLV are live on Robinhood Chain with USDG pairs on Uniswap. GLD has roughly $8M market cap; SLV roughly $1M with $0.2M–0.7M of DEX liquidity. Liquidity is fine for retail SIP tickets, not for large orders.
- **Oracle work:** add a silver futures anchor (COMEX SI) with the existing beta/confidence machinery; silver needs wider event-mode thresholds and a lower LLTV than gold because it gaps harder.
- **Contracts:** one `StackPlan` contract (per-user plans, Permit2 allowance on USDG, permissionless `execute()`), run by the keeper Nightshift already operates every 10 minutes.
- **Biggest blockers are legal, not technical:** Stock Tokens are debt securities with geographic restrictions (no US persons; other countries restricted), and marketing a "SIP" to Indian residents collides with India's 30% + 1% TDS crypto tax and unresolved FEMA treatment. Get counsel before mainnet.
- **Sequence:** testnet SIP on Base demo assets (4–6 weeks) → SLV oracle + gap study → Robinhood Chain deployment with real tokens behind a geofence and an audit.

As of 25 Oct 2026, Nightshift itself is an unaudited demo on Base with valueless test assets; everything here assumes that status changes before real money flows.

## Nightshift today

Nightshift is one off-hours price engine plus five products built on it, for tokenized ETFs. Its pitch: tokens trade 24/7 but traditional feeds freeze at Friday's close, so loans against them are mispriced exactly when news hits ([nightshift.buzz](https://nightshift.buzz)).

| Module | What it does today | Status |
| --- | --- | --- |
| Oracle | Fair value every minute for SPY, QQQ, GLD, IBIT from overnight futures (gold futures for GLD), Asia/Europe markets, momentum and Fear & Greed; confidence 35–98 | Live, public API v1 |
| Vault | Deposit ETF tokens, borrow USDG; Morpho Blue rules; borrow limit = collateral × price × LLTV × confidence haircut | Live on Base, demo assets |
| Guardian | Keeper checks loans every 10 min; alerts or auto-rebalances to a target health factor | Live on Base, demo |
| Cloak | Groth16 proof that a loan is solvent without revealing size; on-chain CloakRegistry | Live proofs |
| Ledger | Hashes each pre-open prediction to Algorand so the track record can't be edited | Testnet |
| Earn | Read-only view of a Sentora PYUSD vault for idle stablecoins | Read-only |

**Oracle mechanics that matter for metals.** Each token's anchor move is scaled by a measured overnight beta (OLS over \~20 nights, Blume-adjusted, clamped 0.5–1.5; fallback 1.0 if R² < 0.3). Confidence falls 0.3 points per closed hour; "event mode" caps it at 70 after a 3% closed-market move (3.5% QQQ, 7% IBIT). Data comes from Yahoo Finance with Twelve Data as backup; the keeper pushes on-chain on a 0.1% move or every 10 minutes, and the contract skips any single move over 15% ([docs](https://nightshift.buzz/docs)).

**Gold is already in.** The live API on 24 Oct 2026 showed GLD fair value $366.18 vs a $366.61 close, anchored to gold futures (−0.13%), beta 1.008, R² 0.955, confidence 89, LLTV 77%, with a dGLD feed and Morpho oracle on Base ([API](https://nightshift.buzz/api/v1/prices)).

**Assurance.** 24 Lean 4 properties (8 Vault, 6 Guardian, 6 Oracle, 4 Cloak) proven with Harmonic's Aristotle; Slither scan; no external audit ([transparency](https://nightshift.buzz/transparency)).

**The gap this paper fills.** Nightshift serves people who already hold ETF tokens and want to borrow. It has no way to *acquire* a position, no recurring behaviour, and runs on Base with demo tokens while the real Stock Tokens live on Robinhood Chain. A metals SIP fixes all three: it creates the holders, it creates habit, and it forces the move to the chain where the real assets are.

## The opportunity

Retail money is moving into metals through exactly the habit Nightshift wants to copy: small, automatic, monthly buys. The demand is proven off-chain; on-chain, the rails exist but nobody combines fair pricing with recurring buys.

**The SIP habit is enormous.** Indian mutual-fund SIPs hit a record ₹32,297 crore in August 2026, up 14% year on year ([AMFI via NewKerala](https://www.newkerala.com/news/a/sip-inflows-hit-record-rs-32297-crore-august-914.htm)). In January 2026 gold ETF inflows (₹24,040 crore) passed equity-fund inflows for the first time, and gold plus silver ETF AUM crossed ₹3 lakh crore, with silver ETF folios quadrupling to 47.85 lakh in five months ([Free Press Journal](https://www.freepressjournal.in/amp/business/gold-silver-etfs-surge-past-3-lakh-crore-aum-in-january-2026-nearly-tripling-in-five-months-on-record-inflows)). Flows stayed positive into September 2026: ₹4,451 crore gold and nearly ₹2,000 crore silver ([5paisa](https://www.5paisa.com/blog/gold-etf-inflows-4451-crore-september-silver-etfs)).

**On-chain gold is a $6B category.** Tokenized gold passed $6B in February 2026, with XAUT and PAXG holding about 97% ([Tangem](https://tangem.com/en/news/stablecoins/14769-tokenized-gold-market-tops-6b-led-by-xaut-and-paxg/)). Tokenized ETF wrappers (GLD, SLV) are far smaller, which is the opening: they carry ETF-style pricing but trade on thin DEX pools.

**Why metals suit SIP better than equities.** Gold and silver are bought to hold, rarely traded, and their buyers are price-averaging by temperament. Silver's volatility is the strongest SIP argument: in mid-October 2026 Indian silver fell about 5.5% in a week while gold fell about 1.8% ([StartupTalky](https://startuptalky.com/news/gold-silver-prices-india-today-16-october-2026/)). Averaging into that is the product.

**Why Nightshift specifically.** A naive on-chain DCA bot buys at whatever the pool says. On a Saturday, an SLV pool with $125K of liquidity can sit well away from where silver futures imply the ETF would open. Nightshift already computes that implied price with a confidence score. Using it as the execution guard is a feature nobody else has, and it is built from parts Nightshift has already proven.

## Asset universe

Start with Robinhood's GLD and SLV Stock Tokens on Robinhood Chain: they are the only metal ETF tokens on the chain Nightshift is named for, they already pair with USDG, and they trade 24/7. Other issuers are useful later for reach, not for launch.

| Token | Issuer · chain | Backing / legal form | Size (latest seen) | Fit for v1 |
| --- | --- | --- | --- | --- |
| [GLD • Robinhood Token](https://www.coingecko.com/en/coins/spdr-gold-shares-robinhood-token) | Robinhood Assets (Jersey) · Robinhood Chain | Tokenised debt security, 1:1 to GLD shares at a licensed custodian | \~$8M mkt cap; GLD/USDG on Uniswap V3 | Yes, core |
| [SLV • Robinhood Token](https://phantom.com/tokens/robinhood/0x411efb0e7f985935daec3d4c3ebaea0d0ad7d89f) | Robinhood Assets (Jersey) · Robinhood Chain | Same structure, tracks iShares Silver Trust | \~$1.1M mkt cap, \~$0.73M liquidity, 7,451 holders (22 Sep 2026) | Yes, core |
| [GLDx / SLVx (xStocks)](https://www.coindesk.com/price/gold-xstock) | Backed Assets (JE) · Solana, Ethereum, others | Tracker certificate, 1:1 GLD/SLV | GLDx \~$7.4M ([rwa.xyz](https://rwa.xyz/assets/GLDx)) | Phase 3, other chains |
| [GLDon / SLVon (Ondo)](https://defillama.com/rwa/asset/SLVon) | Ondo Global Markets (BVI) · Ethereum, BNB, Solana | Structured note, total-return | SLVon \~$29M; GLDon \~$0.7M | Phase 3 |
| [PAXG / XAUT](https://tangem.com/en/news/stablecoins/14769-tokenized-gold-market-tops-6b-led-by-xaut-and-paxg/) | Paxos / Tether · Ethereum + | Allocated physical gold, 1 oz per token | \~$6B combined | Optional: 24/7 asset, no after-hours gap to price |
| [KAG (Kinesis)](https://coingecko.com/coins/kinesis-silver) | Kinesis · Kinesis chain + ERC-20 | Allocated physical silver | \~$214M | Watch only |

Two cautions. First, prices and caps above are snapshots from aggregator pages on different dates; re-check on-chain before launch. Second, Robinhood Chain hosts look-alike memecoins named "Silver" and "AG" paired against SLV ([DexPaprika](https://dexpaprika.com/robinhood/token/0x34a09fda62783e72b6d7f104696d6db208302c6e)). The `StackPlan` contract must allowlist token addresses read from Robinhood's StockFactory (`0x4783C67b63dE2B358Ac5951a7D41F47A38F3C046`, which emits a `Deployed` event per Stock Token) ([Envio](https://docs.envio.dev/blog/index-robinhood-chain-data)), never accept user-supplied addresses.

Reported addresses to verify against the factory: SLV `0x411efb0e7f985935daec3d4c3ebaea0d0ad7d89f`, GLD `0xc9a981fee1f9dec688bb123ccdecc63d0debfc4e`, USDG `0x5fc5360d0400a0fd4f2af552add042d716f1d168`, SLV/USDG Uniswap V3 pool `0x37ed4621d1eb3abc9e551a888e6aaf0a41f7be8e` ([DexPaprika](https://dexpaprika.com/robinhood/pool/0x37ed4621d1eb3abc9e551a888e6aaf0a41f7be8e)).

**Beyond gold and silver.** Platinum (PPLT), palladium (PALL), copper (CPER) and miners (GDX, SIL) were not found as Robinhood Stock Tokens in this research; a third-party guide lists ETFs including "silver and oil funds" among deployed tokens ([SQD](https://sqd.dev/learn/robinhood-tokenized-stocks/)). Index the factory to see the full current list (Envio reports 194 active assets). Add any metal ETF only once it exists and has a USDG pool.

## Oracle extension

Silver slots into the existing model with one new anchor (COMEX silver futures) and three tuned constants; nothing in the proven formulas changes. Metals are actually easier than equities after hours, because their futures trade almost around the clock: CME Globex runs silver and copper Sunday 6:00 pm to Friday 5:00 pm ET with a one-hour daily break ([CME](https://cmegroup.com/trading/metals/precious/silver-futures-and-options.html)).

| ETF token | Anchor | Expected beta | Event-mode trigger (proposed) | Notes |
| --- | --- | --- | --- | --- |
| GLD (live) | COMEX gold futures (GC) | \~1.0 (measured 1.008, R² 0.955) | 3% (current default) | No change needed |
| SLV | COMEX silver futures (SI) | \~1.0 | 5%, cap 55 at 10% | Silver fell 5%+ in one session this month ([Stocktwits](https://stocktwits.com/news-articles/markets/equity/nasdaq-futures-rise-after-chip-selloff-while-s-and-p-500-dow-track-mixed-open-slv-gld-soxl-be-in-focus/cZxyG6qRBDq)) |
| PPLT / PALL | NYMEX platinum (PL) / palladium (PA) | \~1.0 | 6% | Thin futures; expect more stale-anchor caps |
| CPER | COMEX copper (HG) | \~1.0 | 4% | Industrial, trades with China/risk sentiment |
| GDX / SIL (miners) | Gold or silver futures | 1.5–2.5, low R² | 6% | Equity, not metal; likely exceeds the 1.5 beta clamp. Display-only until a longer window proves fit |

**Three changes to the signal blend for metals:**

1. **Swap the sentiment signal.** The crypto Fear & Greed index (10% weight today) has no economic link to silver. Replace it for metal tokens with a dollar signal (US Dollar Index futures, inverse) or simply drop it and renormalise; the O1a proof already guarantees weights stay non-negative and sum to 100%.
2. **Re-define "global markets" for metals.** Use Shanghai and MCX (India) gold/silver prices instead of Asian equity indices. MCX trades into the Indian evening, which overlaps the US pre-market and gives a second read on the overnight move.
3. **Weekend handling stays as is.** From Friday 5 pm to Sunday 6 pm ET all metal futures are shut, so confidence decays 0.3 points per hour, about 15 points over a weekend. That is correct behaviour and it is exactly what the SIP guard reads (next section).

**What must be measured before launch, not assumed:** SLV's overnight beta and R² over 20+ nights; a close-to-open gap study for SLV like the one Nightshift ran for its current four tokens; the distance between the SLV DEX price and the Oracle fair value across weekends. The third number decides how tight the SIP guard can be.

New API fields: add `SLV` to `GET /api/v1/prices` and a `dSLV` Chainlink-style feed plus Morpho oracle, following the dGLD pattern.

## Product design: Nightshift Stack

Nightshift Stack lets a user say "buy $50 of gold and silver every Monday" once, then never overpay for an installment, never lose custody, and borrow against the pile when they need cash. Five plan types cover the demand, from plain SIP to a metals-ratio rebalancer.

| Plan type | How it behaves | Who it's for |
| --- | --- | --- |
| Fixed SIP | Same USDG amount, daily / weekly / monthly, fixed weekday or date | Default; mirrors the mutual-fund SIP habit |
| Basket SIP | One installment split by weights, e.g. 60% GLD / 40% SLV | Users who want "precious metals", not one metal |
| Step-up SIP | Installment rises by a set % every 6 or 12 months | Salary-linked savers (a standard Indian SIP feature) |
| Fair-value boost | Invest up to 1.5× the base amount when the pool trades below Oracle fair value by more than a threshold; 0.5× when above | Users who want discipline plus a small edge |
| Ratio rebalancer | Keeps a target gold:silver value split; each installment buys whichever metal is under weight | Holders who think in allocations |

**The fair-price guard (on for every plan).** Each installment opens an execution window (default 48 hours). The keeper executes only when all three hold: Oracle confidence is at least 75; the DEX quote is no more than 0.5% above Oracle fair value; price impact at the order size is under 0.3%. If the window expires unmet, the user's chosen fallback applies: skip and roll the money into the next installment, or buy anyway at a hard cap (fair value + 1.5%). Defaults are starting points to tune from the measured weekend spread.

**User flow.**

1. Connect wallet on Robinhood Chain; pass the geofence check (see Regulatory).
2. Pick metals and weights, amount, frequency, start date, fallback rule.
3. Sign one Permit2 allowance capped at the plan's total for a period (e.g. 12 installments), not unlimited.
4. Keeper executes each installment inside its window; tokens land in the user's own wallet.
5. Optional: "stack and borrow" auto-deposits each buy into the Vault as collateral, with Guardian on by default.
6. Pause, skip, edit or cancel any time; cancelling revokes the allowance in the same transaction.

**What the user sees.** Average cost per token next to today's fair value; a "premium avoided" counter (sum, over installments, of the gap between the price a naive buy would have paid at the scheduled moment and the guarded execution price); every execution receipt hashed to Algorand by the existing Ledger, so the record of fills can't be edited. That counter is the marketing line: it proves the Oracle's value in dollars per user.

**Idle cash between installments.** USDG waiting for the next buy can sit in a yield vault. Robinhood Earn routes USDG into a Steakhouse-curated Morpho vault at an estimated \~7% APY ([TradeInformer](https://tradeinformer.com/broker-news/robinhood-taps-morpho-to-power-onchain-lending-product-inside-main-app)); Nightshift's Earn panel already shows Sentora. Keep this read-only or user-directed: Nightshift's own disclaimer says it never holds funds, and pulling from a yield vault on a schedule would change that.

## Smart-contract and keeper architecture

Build one new contract, `StackPlan`, and reuse everything else: the Oracle contract for the guard, the existing keeper for scheduling, the Vault for optional collateral, Algorand for receipts.

&#91;embedded content: Proposed Nightshift Stack architecture on Robinhood Chain\]

The user never deposits into Nightshift; `StackPlan` pulls exactly one installment from the wallet at execution, swaps it, and sends the metal token back in the same transaction.

**Core interface (sketch).**

```solidity
struct Plan {
  address owner;
  uint96  amountPerRun;     // USDG, 6 decimals
  uint32  interval;         // seconds: 1d, 7d, 30d
  uint32  nextRun;          // window opens
  uint32  window;           // e.g. 48h
  uint16[] weightsBps;      // per asset, sum 10000
  address[] assets;         // allowlisted Stock Tokens only
  uint16  maxPremiumBps;    // vs Oracle fair value, e.g. 50
  uint8   minConfidence;    // e.g. 75
  uint8   fallbackMode;     // 0 = skip and roll, 1 = buy at cap
  bool    depositToVault;
}
function createPlan(Plan calldata p, PermitData calldata permit) external;
function execute(uint256 planId, bytes calldata route) external; // permissionless
function pause(uint256 planId) external;
function cancel(uint256 planId) external; // also clears allowance
```

`execute` reads `NightshiftOracle.getPrice(token)`, rejects if confidence is below `minConfidence` or the price is older than 1 hour, computes `minOut = amount / (fairValue × (1 + maxPremiumBps))`, and reverts the swap if Uniswap cannot deliver it. Because the contract enforces the guard, a third-party keeper cannot execute a bad fill; the worst it can do is not execute.

**Three ways to hold the user's permission:**

| Approach | How | Pros | Cons | Verdict |
| --- | --- | --- | --- | --- |
| Per-user plan + Permit2 | User signs a capped, expiring Permit2 allowance to `StackPlan` | Works with any wallet; funds stay in wallet; simple to audit | Users must re-sign when the cap or expiry runs out | **Use for v1** |
| Session keys (ERC-7715 / smart accounts) | Wallet grants a scoped "spend X USDG per week on these tokens" permission | Best UX; limits enforced by the wallet | Wallet support uneven; Robinhood Wallet support unverified | v2, if Robinhood Wallet adopts it |
| Pooled batch vault (ERC-4626) | Users deposit; vault buys once per day for everyone | One swap per day, better fills | Custodial; a pooled vehicle over securities tokens raises collective-investment questions | Avoid |

**Keeper.** Nightshift's keeper already wakes every 10 minutes for Guardian. Add a job that lists plans whose window is open and simulates `execute`; submit only those that pass. Robinhood Chain has \~100 ms blocks and ETH gas, so per-installment cost is small; still batch several plans per transaction. A plan with a 48-hour window gets \~288 chances to fill.

**Failure modes, handled in-contract:** stale Oracle (refuse); confidence floor not met (wait); pool too thin for the size (wait, then fallback); token removed from allowlist (pause plan, alert); USDG balance short (skip run, alert); the user changes the allowance (plan auto-pauses). Every outcome, including skips, emits an event the app and the Ledger read.

## Lending against a metals stack

The SIP feeds the products Nightshift already has: a user who has stacked gold for a year can borrow USDG against it at a fairly priced limit, with Guardian protection and an optional private solvency proof. This is the "don't sell your gold, borrow against it" story Indian gold-loan users already understand.

- **Vault.** Add an SLV market beside GLD. Borrow limit stays collateral × price × LLTV × (1 − (100 − confidence)/200). A basket position (GLD + SLV) can start as two isolated markets; Morpho's newer multi-collateral isolated markets let one portfolio back one borrow, which fits a basket SIP later ([Morpho](https://morpho.org/blog/morpho-effect-august-2026-new-all-time-high)).
- **Guardian.** Default to "alert" for SIP users, "auto-protect" opt-in. In production a rebalance must sell through the same Uniswap pools the SIP buys from; with SLV liquidity in the hundreds of thousands of dollars, Guardian sales need size caps and split execution or they will move the price they are protecting against.
- **Stack-and-borrow loop: block it.** Do not let a plan buy metal with borrowed USDG from the same Vault. That turns a savings product into leverage with no visible signal to the user.
- **Cloak.** A stacker can prove "my metal loan is solvent" or, with a small circuit change, "I hold at least X oz-equivalent" without revealing the amount. Useful for lenders, landlords or DAOs that want proof of reserves from an individual.
- **Ledger.** Already hashes pre-open predictions to Algorand; extend it to SIP fill receipts so the "premium avoided" figure is independently checkable.
- **Earn.** Borrowed or idle USDG can be pointed at Robinhood Earn or Sentora, displayed read-only as today.

Real markets on Morpho itself (not Nightshift's demo vault) are the right end state: Robinhood Earn already routes USDG through Morpho on Robinhood Chain, and Morpho is the largest non-DEX TVL source there ([MadeOnSol](https://madeonsol.com/compare/morpho-vs-steakhouse-financial)). A curator listing GLD/SLV collateral with Nightshift's oracle is the partnership to pursue.

## Risk parameters and new proofs

Silver needs a lower LLTV than gold and supply caps tied to DEX depth; the SIP contract needs six new machine-checked properties so it carries the same "proven, not promised" standard as the rest of Nightshift.

| Parameter | GLD (today) | SLV (proposed, pending gap study) | Why |
| --- | --- | --- | --- |
| LLTV | 77% | 68% | Silver gaps 2–3× gold; IBIT sits at 62.5% for the same reason |
| Liquidation bonus (existing formula) | \~7.4% | \~10.6% | min(15%, 1/(0.3·LLTV + 0.7) − 1) |
| Event-mode trigger | 3% | 5% (cap 55 at 10%) | Avoid capping on ordinary silver days |
| Collateral supply cap | Set from pool depth | ≤ 2× SLV/USDG liquidity | A forced sale must not exhaust the pool |
| SIP max premium | 0.5% | 0.75% | Wider spreads on the thinner pool |
| Per-installment cap | $5,000 | $1,000 | Keeps price impact under 0.3% |

All SLV numbers are placeholders. Run the same close-to-open study Nightshift used to set its current LLTVs, on SLV history since 2006, and publish it on the Docs page.

**New Lean properties for `StackPlan`:**

1. **S1 Price bound:** an executed installment never pays more per token than fair value × (1 + maxPremium).
2. **S2 Spend bound:** one run never spends more than `amountPerRun`; the sum of runs never exceeds the signed Permit2 cap.
3. **S3 Allocation:** basket weights spend the installment exactly, with rounding always against the protocol, never the user.
4. **S4 Guard gate:** `execute` cannot succeed when confidence is below the floor or the price is stale.
5. **S5 Cancel:** after `cancel`, no later call can move the owner's funds.
6. **S6 Allowlist:** a plan can only ever deliver tokens on the allowlist, to the plan owner (or the Vault on the owner's behalf).

**Adversarial testing.** Extend the Guardian fuzzer with weekend gap paths for silver (±5–15%), a stale-Oracle path, and a sandwich attacker on the pool; `minOut` should bound the attacker's take to the premium allowance. Note that Robinhood runs Robinhood Chain's sequencer itself ([Alea Research](https://alearesearch.io/newsletters/robinhood-chain-distribution-arrives)), so ordering is centralised: less public-mempool MEV, more trust in one operator.

**Operational risks.** Yahoo Finance is the primary data source with Twelve Data as backup; for a product that executes real buys, add a licensed futures feed or Chainlink's own Robinhood Chain feeds as a cross-check. Keep Nightshift's existing rule that simulated prices are never pushed on-chain.

## Regulatory, tax and jurisdiction

This is the section that decides whether Stack ships, and it needs a lawyer, not this paper. Running recurring purchases of securities tokens for strangers moves Nightshift from "data provider" toward "arranging investments" in many jurisdictions. What follows is a map of the issues, not legal advice.

**The asset is a security, with a geofence built in.** Robinhood's Stock Tokens are tokenised debt securities issued by Robinhood Assets (Jersey) Limited. They give economic exposure only, no rights in the underlying ETF. They are not available in the US or to US persons, and are restricted in Canada, the UK, Switzerland, the UAE and sanctioned jurisdictions, among others ([Robinhood](https://robinhood.com/newsroom/robinhood-accelerates-global-expansion-robinhood-chain-mainnet-stock-tokens-agentic-trading/)). Nightshift's own footer already says Stock Tokens are not for US persons; Stack must enforce at least Robinhood's list in the app, and ideally require an on-chain eligibility attestation before `createPlan`.

**Nightshift's role changes.** Today it publishes prices and runs a demo. With Stack it (a) chooses execution timing, (b) routes orders, and (c) markets a savings plan. Each can trigger broker, investment-adviser or collective-investment rules depending on the country. Design choices that lower the risk: non-custodial only (no pooled vault); the user picks every parameter; no performance claims; no "SIP" marketing that implies a regulated fund.

**India specifically (the founder's home market).**

- **Tax.** Tokenised stocks are treated as virtual digital assets in India: 30% flat tax on gains with no loss offset, plus a 1% TDS on transfers ([Lets Data Science](https://letsdatascience.com/news/indians-purchase-tokenised-us-stocks-anytime-60f9faad); [Decrypt](https://decrypt.co/356601/no-relief-for-crypto-investors-as-india-retains-current-crypto-tax-in-budget-2026)). Budget 2026 kept both and added reporting penalties from 1 April 2026 ([Whale Alert summary](https://whale-alert.io/stories/978301d668f6a4/India-retains-30-crypto-tax-and-1-TDS-in-Budget-2026-bars-deductions-adds-reporting-penalties-and-eases-TDS-criminal-liability-to-2-years)). A weekly installment is a VDA swap every week, so the TDS and reporting burden scales with the SIP's frequency.
- **FEMA.** Buying these tokens sits outside the $250,000 LRS route, and whether that is permitted remains unresolved as of mid-2026 ([Lets Data Science](https://letsdatascience.com/news/indians-purchase-tokenised-us-stocks-anytime-60f9faad)).
- **Comparison an Indian user will make.** A domestic gold or silver ETF SIP through a mutual fund is regulated, has no 1% TDS, and gets ordinary capital-gains treatment. On after-tax terms Stack loses for Indian residents.
- **Availability.** Robinhood's consumer brokerage does not operate in India ([Investing in the Web](https://investingintheweb.com/brokers/robinhood-india)); whether the self-custody Stock Tokens are offered to Indian residents was not confirmed in this research. Check Robinhood's current restricted-country list directly.

**Implication.** Use India's SIP and gold-ETF data as evidence that the habit is real, but do not make Indian residents the launch market. Launch where Stock Tokens are clearly offered and crypto tax is lighter (much of Latin America, Southeast Asia and Africa among Robinhood's 120+ countries), with each country cleared by counsel.

**Disclosures to carry over.** Unaudited until audited; Oracle values are data, not advice; Nightshift does not issue or sell tokens; Stock Tokens give no shareholder rights and carry issuer and custodian counterparty risk.

## Go-to-market and success metrics

Lead with one provable number, "premium avoided", and with the weekend: metals move on Friday nights and Sunday evenings when traditional feeds are frozen, which is exactly when Nightshift has something to say.

**Channels.**

- **Weekend metals shift report.** Extend the existing graded Shift report to GLD and SLV, posted Sunday before Globex reopens and graded Monday at the open. It doubles as SIP education and Oracle credibility.
- **Leaderboard.** The site already has one; add "most consistent stacker" (installments filled in a row) rather than P&L, which rewards the behaviour Stack wants.
- **Robinhood Chain ecosystem.** Robinhood Wallet integrates the chain directly and Uniswap is the main liquidity venue ([CertiK](https://www.certik.com/blog/robinhood-chain-onchain-capital-market)). Pitch Stack to the Robinhood Chain team as a retention feature for their Stock Tokens.
- **Morpho and curators.** A Morpho market for GLD/SLV with the Nightshift oracle gives stackers a real borrow venue and gives Nightshift a partner with distribution.
- **Index projects.** OpenIndex already publishes a 60/40 GLD/SLV index built on Robinhood Stock Tokens ([OpenIndex](https://www.openindex.site/index/metals)); a Basket SIP that tracks a published index is easier to explain.

| Metric | Definition | Target, first 90 days of mainnet |
| --- | --- | --- |
| Active plans | Plans with an installment in the last 2 intervals | 500 |
| 6-run retention | Plans still active after 6 installments | ≥ 60% |
| Fill rate | Installments filled inside their window | ≥ 95% |
| Premium avoided | Avg. saving vs naive execution, per $1,000 | Publish whatever it is; > $2 is a headline |
| Monthly stacked volume | USDG converted through Stack | $250K |
| Stack-to-collateral | Share of stacked value later posted in the Vault | 10–20% |
| Guardian saves | Loans lifted above 1.0 health before liquidation | Track, no target |

Targets are planning guesses for a demo-stage product, not forecasts; replace them after the testnet phase.

## Phased roadmap

About 14 weeks from today to a real-money pilot, with no real funds until an external audit and country-by-country legal sign-off are done.

&#91;embedded content: Proposed phases; durations are estimates for a small team\]

Phases 0 and 1 reuse the current Base demo stack, so they cost little and produce the two numbers everything else depends on: SLV's gap profile and the weekend spread between DEX price and fair value. The Morpho market in phase 3 depends on a curator agreeing to list the collateral.

## Open questions and key risks

The five risks that could kill or reshape Stack, most serious first, followed by what still has to be found out.

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Regulatory classification | Recurring buys of securities tokens may make Nightshift a broker or adviser in some countries | Counsel per launch country; non-custodial only; user sets every parameter; no pooled vault |
| Thin SLV liquidity | \~$0.2M–0.7M across pools; large plans or Guardian sales move price | Per-installment caps, supply caps, split execution, fair-price guard |
| Issuer and custodian risk | Tokens are Robinhood Jersey debt securities, no rights in GLD/SLV | Disclose plainly; diversify issuers in phase 3 |
| Oracle data quality | Yahoo/Twelve Data are free feeds; real buys now depend on them | Licensed futures data or Chainlink cross-check before mainnet |
| Robinhood platform dependence | Robinhood runs the sequencer, issues the tokens, sets eligibility | Keep the Oracle and Stack chain-agnostic; port to xStocks/Ondo chains |

**Still to find out:**

- [ ] Is Robinhood's Stock Token offer open to residents of India and each target launch country? Get the current list from Robinhood.
- [ ] Do Robinhood Stock Tokens carry transfer restrictions or allowlists at the contract level? DefiLlama marks the older Classic SLV token as permissioned ([DefiLlama](https://defillama.com/rwa/asset/slvrh)); confirm the Robinhood Chain versions.
- [ ] Full metal ETF list on Robinhood Chain: index the StockFactory `Deployed` events.
- [ ] SLV overnight beta, R² and 20-year gap distribution.
- [ ] Typical weekend gap between SLV/GLD DEX price and Oracle fair value; sets `maxPremium` and the value of "premium avoided".
- [ ] Does Robinhood Wallet support session-key permissions (ERC-7715-style) for a v2 UX?
- [ ] Would a Morpho curator list GLD/SLV collateral with the Nightshift oracle, and on what LLTV?
- [ ] Should physical-gold tokens (PAXG/XAUT) be offered as a 24/7 alternative where Stock Tokens are restricted?

## Sources

Nightshift pages were read in full on 25 Oct 2026; other figures come from the pages and search snapshots below and should be re-checked on-chain before launch.

**Nightshift:** [Home](https://nightshift.buzz) · [Docs](https://nightshift.buzz/docs) · [Oracle](https://nightshift.buzz/oracle) · [App](https://nightshift.buzz/app) · [Transparency](https://nightshift.buzz/transparency) · [API v1 prices](https://nightshift.buzz/api/v1/prices)

**Robinhood Chain and Stock Tokens:**

- [Robinhood newsroom: Chain mainnet, Stock Tokens](https://robinhood.com/newsroom/robinhood-accelerates-global-expansion-robinhood-chain-mainnet-stock-tokens-agentic-trading/)
- [Cointelegraph: Robinhood Chain mainnet](https://cointelegraph.com/news/robinhood-public-blockchain-mainnet-launch)
- [Alea Research: distribution arrives](https://alearesearch.io/newsletters/robinhood-chain-distribution-arrives)
- [CertiK: Robinhood Chain ecosystem](https://www.certik.com/blog/robinhood-chain-onchain-capital-market)
- [Envio: indexing Robinhood Chain assets](https://docs.envio.dev/blog/index-robinhood-chain-data)
- [SQD: tokenized stocks on Robinhood Chain](https://sqd.dev/learn/robinhood-tokenized-stocks/)
- [CoinGecko: GLD Robinhood Token](https://www.coingecko.com/en/coins/spdr-gold-shares-robinhood-token) · [Phantom: SLV Robinhood Token](https://phantom.com/tokens/robinhood/0x411efb0e7f985935daec3d4c3ebaea0d0ad7d89f) · [DexPaprika: SLV/USDG pool](https://dexpaprika.com/robinhood/pool/0x37ed4621d1eb3abc9e551a888e6aaf0a41f7be8e) · [DexPaprika: SLV/GLD pool](https://dexpaprika.com/robinhood/pool/0x48abc7052509caf820c4c22559f08381f9afd823)
- [OpenIndex: GLD/SLV metals index](https://www.openindex.site/index/metals)

**Other metal tokens:** [CoinDesk: GLDx](https://www.coindesk.com/price/gold-xstock) · [rwa.xyz: GLDx](https://rwa.xyz/assets/GLDx) · [DefiLlama: SLVon](https://defillama.com/rwa/asset/SLVon) · [DefiLlama: SLVrh](https://defillama.com/rwa/asset/slvrh) · [Tangem: tokenized gold tops $6B](https://tangem.com/en/news/stablecoins/14769-tokenized-gold-market-tops-6b-led-by-xaut-and-paxg/) · [CoinGecko: Kinesis Silver](https://coingecko.com/coins/kinesis-silver)

**Lending:** [TradeInformer: Robinhood Earn on Morpho](https://tradeinformer.com/broker-news/robinhood-taps-morpho-to-power-onchain-lending-product-inside-main-app) · [Morpho Effect, Aug 2026](https://morpho.org/blog/morpho-effect-august-2026-new-all-time-high) · [MadeOnSol: Morpho vs Steakhouse](https://madeonsol.com/compare/morpho-vs-steakhouse-financial)

**Markets and futures:** [CME silver futures specs](https://cmegroup.com/trading/metals/precious/silver-futures-and-options.html) · [Stocktwits: SLV and GLD selloff](https://stocktwits.com/news-articles/markets/equity/nasdaq-futures-rise-after-chip-selloff-while-s-and-p-500-dow-track-mixed-open-slv-gld-soxl-be-in-focus/cZxyG6qRBDq) · [StartupTalky: India gold/silver prices, 16 Oct 2026](https://startuptalky.com/news/gold-silver-prices-india-today-16-october-2026/)

**India demand, tax and rules:** [NewKerala: SIP inflows Aug 2026](https://www.newkerala.com/news/a/sip-inflows-hit-record-rs-32297-crore-august-914.htm) · [Free Press Journal: gold and silver ETF AUM](https://www.freepressjournal.in/amp/business/gold-silver-etfs-surge-past-3-lakh-crore-aum-in-january-2026-nearly-tripling-in-five-months-on-record-inflows) · [5paisa: Sep 2026 ETF inflows](https://www.5paisa.com/blog/gold-etf-inflows-4451-crore-september-silver-etfs) · [Decrypt: Budget 2026 crypto tax](https://decrypt.co/356601/no-relief-for-crypto-investors-as-india-retains-current-crypto-tax-in-budget-2026) · [Whale Alert: Budget 2026 penalties](https://whale-alert.io/stories/978301d668f6a4/India-retains-30-crypto-tax-and-1-TDS-in-Budget-2026-bars-deductions-adds-reporting-penalties-and-eases-TDS-criminal-liability-to-2-years) · [Lets Data Science: tokenised stocks in India](https://letsdatascience.com/news/indians-purchase-tokenised-us-stocks-anytime-60f9faad) · [Investing in the Web: Robinhood in India](https://investingintheweb.com/brokers/robinhood-india)
