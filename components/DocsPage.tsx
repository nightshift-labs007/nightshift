"use client";

import Link from "next/link";
import { DEPLOYMENT, addrUrl, isDeployed, sym } from "@/lib/chain";
import { PageHero, PageShell } from "./Site";
import { useApi } from "./useApi";

type Health = {
  ok: boolean;
  config?: { priceFallback?: boolean; cron?: boolean; alerts?: boolean };
  prices?: Record<string, { ageSec: number; confidence: number }>;
};

const ago = (s: number) => (s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} min ago` : `${(s / 3600).toFixed(1)} h ago`);

function LiveStatus() {
  const { data: h } = useApi<Health>("/api/health", 60_000);
  const ages = Object.values(h?.prices ?? {}).map((p) => p.ageSec);
  const rows: [string, string, boolean | null][] = [
    ["System health", h ? (h.ok ? "OK" : "Issues reported") : "…", h ? h.ok : null],
    ["Backup price source (Twelve Data)", h ? (h.config?.priceFallback ? "On" : "Off: Yahoo Finance only, then labelled simulated data") : "…", h ? !!h.config?.priceFallback : null],
    ["Last on-chain price update", ages.length ? ago(Math.min(...ages)) : "…", ages.length ? Math.min(...ages) < 3600 : null],
  ];
  return (
    <div className="card panel docs-status">
      <div className="unit">Live status (from /api/health)</div>
      <table className="contracts">
        <tbody>
          {rows.map(([k, v, good]) => (
            <tr key={k}>
              <td>{k}</td>
              <td className={good === null ? "muted" : good ? "up" : "amber"}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Q({ id, q, children }: { id: string; q: string; children: React.ReactNode }) {
  return (
    <article className="card docs-q" id={id}>
      <h3>{q}</h3>
      {children}
    </article>
  );
}
const Now = ({ children }: { children: React.ReactNode }) => (
  <div className="docs-part">
    <span className="badge live">Today</span>
    {children}
  </div>
);
const Next = ({ children }: { children: React.ReactNode }) => (
  <div className="docs-part">
    <span className="badge paper">Next</span>
    {children}
  </div>
);

const TOC: [string, string][] = [
  ["oracle", "Oracle and pricing"],
  ["verification", "Formal verification and security"],
  ["lending", "Vault, Guardian and lending"],
  ["cloak", "Cloak (zero-knowledge proofs)"],
];

export function DocsPage() {
  const tokens = Object.entries(DEPLOYMENT.tokens ?? {});
  return (
    <PageShell>
      <PageHero
        overline="DOCS · HOW NIGHTSHIFT WORKS"
        title="What's live, how it works, and what isn't done yet."
        lead="Straight answers to the questions partners and reviewers ask most. Where something is a demo or not built yet, it says so. Nightshift is an unaudited demonstration: the Vault on Base uses demo assets with no value."
      />
      <section className="block">
        <div className="wrap docs">
          <nav className="docs-toc" aria-label="Sections">
            {TOC.map(([id, t]) => (
              <a key={id} href={`#${id}`}>
                {t}
              </a>
            ))}
          </nav>
          <LiveStatus />

          <h2 className="docs-h" id="oracle">Oracle and pricing</h2>

          <Q id="fair-value" q="How is the fair-value model implemented in production (data sources, update frequency, fallback)?">
            <Now>
              <p>
                For each ETF token (SPY, QQQ, GLD, IBIT) the Oracle blends several signals into one fair value: the overnight anchor (S&amp;P
                500 or Nasdaq-100 futures, gold futures, or Bitcoin for IBIT), Asian and European markets, short-term momentum of the anchor,
                and the crypto Fear &amp; Greed index. The fair value is the weighted average of the signals' estimates. Weights are learned
                from how accurately each signal predicted recent opens (currently about 20 graded sessions), and always stay positive and sum
                to 100% (proven, properties O1a and O1b).
              </p>
              <p>
                Confidence runs from 35 to 98 (proven, O3): <code>clamp(35, 98, 98 − 0.3·hours closed − 0.5·signal disagreement − 10·simulated)</code>.
                It falls the longer markets are closed and the more the signals disagree.
              </p>
              <p>
                <b>Data:</b> Yahoo Finance first, then Twelve Data as a second source when it is configured (see live status above). If both
                fail, the Oracle uses clearly labelled simulated data, and simulated prices are never pushed on-chain. <b>Frequency:</b> fair
                values are recomputed on request from data cached for 2 minutes (hourly bars) and 10 minutes (daily bars). <b>On-chain:</b>{" "}
                the keeper pushes a price when it has moved more than 0.1% or is older than 10 minutes; the keeper currently runs about every
                30 minutes. The Oracle contract skips any single update that moves a price more than 15% (it emits <code>PriceSkipped</code>);
                only the owner can force such a move.
              </p>
            </Now>
            <Next>
              <p>A freshness and volume check per signal, so a stale or thin signal drops out of the blend and lowers confidence; a keeper on an exact 5-minute schedule.</p>
            </Next>
          </Q>

          <Q id="beta" q="How are betas estimated (Blume adjustment, recalculation, low R²)?">
            <Now>
              <p>
                <b>The four ETF tokens (used for lending)</b> use a fixed beta of 1.0 to their anchor: SPY to S&amp;P 500 futures, QQQ to
                Nasdaq-100 futures, GLD to gold, IBIT to Bitcoin. These are not estimated today.
              </p>
              <p>
                <b>Top Stocks (display only, not used for lending)</b> estimate each stock's beta from about three months of daily returns
                against SPY or QQQ (whichever its anchor tracks), then apply the Blume adjustment, <code>β_adj = 0.67·β + 0.33</code>, clamped
                to 0.3–3. With fewer than 15 overlapping days the beta defaults to 1 with R² 0.3. Betas are recalculated on every board
                refresh (about every 10 minutes). A low R² does not change the estimate; it lowers confidence by (1 − R²)×25 points.
              </p>
            </Now>
            <Next>
              <p>Measured, published ETF betas (rolling intraday window, recalculated daily); for low-R² stocks, a blend toward the sector ETF or a "low reliability" flag with a wider band.</p>
            </Next>
          </Q>

          <Q id="api" q="What's the public API, and can other protocols consume the feed directly?">
            <Now>
              <ul>
                <li><code>GET /api/oracle</code>: all assets with fair value, confidence and every signal's estimate</li>
                <li><code>GET /api/oracle/SPY</code>: one asset</li>
                <li><code>GET /api/series?token=SPY&amp;range=12H</code>: fair-value history (1H, 4H, 12H, 24H)</li>
                <li><code>GET /api/shift-report</code>: predicted versus actual opens, last 10 sessions</li>
                <li><code>GET /api/stocks</code>: the Top Stocks board</li>
              </ul>
              <p>
                <b>On-chain (Base):</b> <code>NightshiftOracle.getPrice(token)</code> returns price, confidence and update time. Each token
                also has a <b>Morpho Blue-compatible adapter</b> (<code>price()</code> in Morpho&apos;s 10³⁶ scale), tested against the real
                Morpho Blue contract on a fork of Base.
              </p>
              {isDeployed && (
                <table className="contracts">
                  <tbody>
                    <tr>
                      <td>NightshiftOracle</td>
                      <td className="mono">
                        <a href={addrUrl(DEPLOYMENT.contracts.oracle)} target="_blank" rel="noopener noreferrer">{DEPLOYMENT.contracts.oracle} ↗</a>
                      </td>
                    </tr>
                    {tokens.map(([s, t]) => (
                      <tr key={s}>
                        <td>Morpho adapter · {sym(s)}</td>
                        <td className="mono">
                          <a href={addrUrl(t.adapter)} target="_blank" rel="noopener noreferrer">{t.adapter} ↗</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Now>
            <Next>
              <p>A Chainlink-style feed (<code>latestRoundData</code>) per token, a versioned <code>/api/v1</code> with documentation and rate limits.</p>
            </Next>
          </Q>

          <Q id="gaps" q="How are weekends, holidays and big overnight news handled?">
            <Now>
              <p>
                While markets are closed, confidence falls 0.3 points per hour, and lower confidence shrinks how much can be borrowed (see
                lending below). IBIT follows Bitcoin through the weekend. NYSE holidays and 1:00 pm early closes (2026–2027 calendar) are built
                in, so a holiday counts as closed and no pre-open call is published for it.
              </p>
              <p>
                <b>News:</b> a news signal (an AI model scoring the latest headlines) is built but switched off, so today a news event reaches
                the Oracle only through futures and other markets. The 15% per-update cap on-chain limits how far one bad print can move a
                price.
              </p>
            </Now>
            <Next>
              <p>An "event mode": when a signal jumps sharply while markets are closed, or the signals strongly disagree, confidence drops faster and borrowing tightens automatically.</p>
            </Next>
          </Q>

          <h2 className="docs-h" id="verification">Formal verification and security</h2>

          <Q id="proofs" q="Which properties are machine-proven, and are the proofs public?">
            <Now>
              <p>
                24 properties: 8 for the Vault, 6 for the Guardian, 6 for the Oracle and 4 for Cloak. They are written in Lean 4, proven with
                Harmonic&apos;s Aristotle and re-checked by Lean&apos;s kernel. Each one, with a plain-English summary and its Lean source, is
                on <Link href="/transparency">Transparency</Link>; the sources are public at <code>/verified/src/</code>. A manifest of all 24
                is fingerprinted (SHA-256) and the fingerprint is recorded on Algorand, and 43 test cases check that the Lean models and the
                Solidity contracts give the same answers.
              </p>
              <p>
                <b>Limits:</b> the proofs cover mathematical models of the contracts&apos; logic, not the compiled bytecode, and the ZK circuit
                itself is not formally verified. The code-to-model mapping and known gaps are in <a href="/verified/src/MAPPING.md">MAPPING.md</a>.
              </p>
            </Now>
            <Next>
              <p>A public proofs-only repository with a one-command re-check.</p>
            </Next>
          </Q>

          <Q id="audit" q="Are the contracts audited?">
            <Now>
              <p>
                No. There is no independent audit yet. Today&apos;s assurance is the formal proofs above, contract tests, the model-versus-contract
                checks and Sourcify-verified source code. That is why every page labels the Vault an unaudited demo with assets of no value.
              </p>
            </Now>
            <Next>
              <p>Published automated-analysis reports (Slither, Aderyn), a written threat model, then an external audit before any real assets.</p>
            </Next>
          </Q>

          <Q id="guardian-proofs" q="What exactly is proven about the Guardian, and has it been tested against adversarial prices?">
            <Now>
              <p>
                Proven: the collateral used is never negative (G1) and never more than you have (G2); the loan lands exactly on your target
                health (G3); any smaller amount would miss the target (G3b); if using collateral can&apos;t help, the Guardian does nothing (G4);
                and it only acts on loans that can still be saved (G5). The contract enforces the same rules: it acts only when 1 ≤ health &lt;
                trigger, refuses insolvent loans, and caps the amount at both the collateral and the debt.
              </p>
              <p><b>Not yet:</b> fuzzing against random or adversarial price paths.</p>
            </Now>
            <Next>
              <p>Fuzz and scenario tests (Monday gaps, crash-and-recover, prices straddling the trigger) checking every invariant after each step, with published results.</p>
            </Next>
          </Q>

          <h2 className="docs-h" id="lending">Vault, Guardian and lending</h2>

          <Q id="morpho" q="Is the Vault a live Morpho Blue market?">
            <Now>
              <p>
                No. The Vault is Nightshift&apos;s own contract on Base that follows Morpho Blue&apos;s rules (health factor, LLTV, liquidation
                incentive). The price adapters are Morpho-compatible and were tested against the real Morpho Blue contract on a fork of Base:
                the market was created, borrowing to the limit worked, one unit more was refused, and a 20% price drop made the loan
                liquidatable.
              </p>
            </Now>
            <Next>
              <p>A demo market on Morpho Blue on Base; then a market with a licensed tokenized-ETF collateral and a real loan asset, listed by a Morpho curator, after an audit.</p>
            </Next>
          </Q>

          <Q id="keeper" q="How does the Guardian keeper work in practice, and what if it's offline?">
            <Now>
              <p>
                You set a rule per loan: alert only, or auto-protect with a trigger (for example 1.15) and a target (for example 1.40). On each
                run the keeper checks every loan with a rule and calls <code>protect()</code> when 1 ≤ health &lt; trigger. A rebalance in this
                demo means the Vault takes just enough collateral at the Oracle price minus 0.5% and cancels the same value of debt; nothing
                is traded on a DEX. <code>protect()</code> is permissionless, so anyone can run a keeper.
              </p>
              <p>
                <b>Alerts</b> appear in the app as banners and pop-ups, and as browser notifications if you allow them, while the page is
                open. <b>Frequency:</b> about every 30 minutes today, on a best-effort scheduler. <b>Gas:</b> default pricing with explicit
                transaction ordering.
              </p>
              <p>
                <b>Failure modes:</b> if the keeper is offline, nobody rebalances loans, and once health falls below 1 anyone can liquidate.
                If a rebalance can&apos;t reach the target, the contract refuses and the app shows an alert. The Vault accepts on-chain prices
                up to 7 days old so lending keeps working through long weekends; if price updates stopped, an old price (with the confidence
                it was pushed with) would remain usable for up to a week.
              </p>
            </Now>
            <Next>
              <p>An exact 5-minute keeper with a public heartbeat, email and Telegram alerts, a gas ceiling with retries, a shorter maximum price age with confidence decaying on-chain, and DEX-routed rebalancing in production.</p>
            </Next>
          </Q>

          <Q id="lltv" q="What liquidation parameters are used for the ETF tokens?">
            <Now>
              <p>
                LLTV is 77% for SPY, QQQ and GLD, and 62.5% for IBIT, which is more volatile. The borrow limit is collateral × price × LLTV ×
                a confidence haircut, <code>1 − (100 − confidence)/200</code>, so a less certain price lends less; new borrowing stops below
                confidence 40. The liquidation bonus is <code>min(15%, 1/(0.3·LLTV + 0.7) − 1)</code>: about 7.4% at 77% and 12.7% at 62.5%,
                capped at 15% (proven, V6).
              </p>
              <p><b>Not yet:</b> a written rationale backed by historical gap analysis, and a comparison with live Morpho tokenized-stock markets.</p>
            </Now>
            <Next>
              <p>A risk-parameter note: worst overnight and weekend gaps for each ETF over 10+ years, and the LLTV each one supports.</p>
            </Next>
          </Q>

          <h2 className="docs-h" id="cloak">Cloak (zero-knowledge proofs)</h2>

          <Q id="cloak-attests" q="What does a Cloak proof attest to, and who verifies it?">
            <Now>
              <p>
                A Cloak proof (Groth16, 918 constraints) shows <code>debt × 10⁸ &lt; units × price × LLTV</code>, meaning health above 1 at the
                stated price and LLTV, without revealing the units or the debt. It also outputs a commitment to the hidden numbers. Collateral
                is rounded down and debt up before proving, so a passing proof still holds for the real loan (proven, C4). Proofs are made in
                the browser.
              </p>
              <p>
                <b>Who verifies:</b> the server checks the proof and that its price matches the live Oracle (within 0.5%) and its LLTV matches
                the market. &ldquo;Verify on-chain&rdquo; has the Groth16 verifier contract on Base check the math, then compares the
                proof&apos;s price and LLTV with NightshiftOracle and the Vault on Base; only when all three agree does it show
                &ldquo;Verified&rdquo;. The verifier contract on its own checks only the math.
              </p>
              <p><b>Not yet:</b> proofs of a specific health level, binding a proof to a specific Vault position, and a multi-party trusted setup (today&apos;s setup was run by one party).</p>
            </Now>
            <Next>
              <p>A registry contract that checks the price against the Oracle on-chain, optional &ldquo;health ≥ X&rdquo; proofs, position binding, and a multi-party setup ceremony.</p>
            </Next>
          </Q>
        </div>
      </section>
    </PageShell>
  );
}
