"use client";

import Link from "next/link";
import { DEPLOYMENT, addrUrl, isDeployed, sym, txUrl } from "@/lib/chain";
import type { OracleSnapshot } from "@/lib/oracle";
import { PageHero, PageShell } from "./Site";
import { useApi } from "./useApi";

type Health = {
  ok: boolean;
  config?: { priceFallback?: boolean; cron?: boolean; alerts?: boolean };
  prices?: Record<string, { ageSec: number; confidence: number }>;
};
type Fuzz = {
  generatedAt: string;
  seed: number;
  scenarios: number;
  stepsPerScenario: number;
  passed: boolean;
  violationCount: number;
  stats: { steps: number; protectCalls: number; protected: number; refusedHealthy: number; refusedLiquidatable: number; liquidations: number };
  named: { name: string; ok: boolean }[];
};
type Slither = { tool: string; summary: string; findings: { severity: string; detector: string; where: string; status: string; note: string }[] };

const ago = (s: number) => (s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} min ago` : `${(s / 3600).toFixed(1)} h ago`);
const link = (a: string) => (
  <a href={addrUrl(a as `0x${string}`)} target="_blank" rel="noopener noreferrer">
    {a} ↗
  </a>
);

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

function BetaTable() {
  const { data } = useApi<OracleSnapshot>("/api/oracle", 120_000);
  if (!data) return <p className="muted small">Loading measured betas…</p>;
  return (
    <table className="contracts">
      <thead>
        <tr><td>Token</td><td>Anchor</td><td>Beta used</td><td>Raw OLS</td><td>R²</td><td>Nights</td></tr>
      </thead>
      <tbody>
        {data.quotes.map((q) => (
          <tr key={q.token}>
            <td>{q.token}</td>
            <td>{q.anchorName}</td>
            <td className="mono">{q.beta ? q.beta.value.toFixed(3) : "1.000"}{q.beta?.fallback ? ` (fallback: ${q.beta.fallback})` : ""}</td>
            <td className="mono">{q.beta?.raw != null ? q.beta.raw.toFixed(3) : "–"}</td>
            <td className="mono">{q.beta?.r2 != null ? q.beta.r2.toFixed(2) : "–"}</td>
            <td className="mono">{q.beta?.sessions ?? "–"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FuzzSummary() {
  const { data: f } = useApi<Fuzz>("/verified/guardian-fuzz.json", 0);
  if (!f) return <p className="muted small">Loading fuzz results…</p>;
  return (
    <div className="docs-box">
      <p>
        <b className={f.passed ? "up" : "down"}>{f.passed ? "Passed" : "Failed"}</b>: {f.stats.steps.toLocaleString()} random price moves across{" "}
        {f.scenarios} loans (seed {f.seed}), {f.stats.protectCalls.toLocaleString()} Guardian checks: it acted {f.stats.protected} times,
        correctly refused {f.stats.refusedHealthy.toLocaleString()} healthy and {f.stats.refusedLiquidatable} already-liquidatable loans, and{" "}
        {f.stats.liquidations} loans below health 1 were liquidated. {f.violationCount} invariant violations. Run{" "}
        {new Date(f.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.
      </p>
      <ul className="docs-checks">
        {f.named.map((n) => (
          <li key={n.name} className={n.ok ? "up" : "down"}>{n.ok ? "✓" : "✗"} {n.name}</li>
        ))}
      </ul>
      <p className="small muted">
        Full results: <a href="/verified/guardian-fuzz.json">guardian-fuzz.json</a>. Reproduce with <code>node scripts/fuzz-guardian.mjs</code>.
      </p>
    </div>
  );
}

function SlitherSummary() {
  const { data: s } = useApi<Slither>("/verified/security/slither.json", 0);
  if (!s) return <p className="muted small">Loading scan report…</p>;
  return (
    <div className="docs-box">
      <p>{s.summary}</p>
      <table className="contracts">
        <thead>
          <tr><td>Severity</td><td>Finding</td><td>Status</td></tr>
        </thead>
        <tbody>
          {s.findings.filter((f) => f.severity !== "Informational").map((f) => (
            <tr key={f.detector + f.where}>
              <td>{f.severity}</td>
              <td>
                <b>{f.detector}</b> · {f.where}
                <div className="small muted">{f.note}</div>
              </td>
              <td className={f.status === "fixed" ? "up" : "muted"}>{f.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">{s.tool}. Full report: <a href="/verified/security/slither.json">slither.json</a>.</p>
    </div>
  );
}

type Gaps = { nights: number; p99FallPct: number; worstFallPct: number; worst: { date: string; kind: string; movePct: number }[]; meanAbsPct?: number };
type Lltv = {
  generatedAt: string;
  method: { badDebtLine: string; frozen: string; nightshift: string; rule: string; caveats: string[] };
  enabledLltvs: { lltv: number; lif: number; badDebtFallPct: number }[];
  tokens: {
    token: string;
    anchor: string;
    currentLltv: number;
    history: Gaps & { from: string };
    nightshiftWindow: { from: string; nights: number; frozen: Gaps; nightshift: Gaps };
    recommended: { frozenFullHistory: number | null; nightshiftWindow: number | null };
  }[];
  morphoTokenizedMarkets: { chainId: number; collateral: string; name: string; loan: string; lltv: number; supplyUsd: number }[];
};
const CHAINS: Record<number, string> = { 1: "Ethereum", 8453: "Base", 4663: "Robinhood Chain", 143: "Monad", 999: "HyperEVM", 42161: "Arbitrum" };
const lp = (l: number | null) => (l == null ? "none" : `${+(l * 100).toFixed(1)}%`);

function LltvStudy() {
  const { data: d } = useApi<Lltv>("/verified/lltv-study.json", 0);
  if (!d) return <p className="muted small">Loading the gap study…</p>;
  const line = (l: number) => d.enabledLltvs.find((e) => e.lltv === l)?.badDebtFallPct;
  return (
    <div className="docs-box">
      <p>{d.method.badDebtLine} The open is the one jump no liquidator can act inside, so it is what LLTV has to absorb.</p>
      <table className="contracts">
        <thead>
          <tr><td>Token</td><td>Worst fall at the open, frozen price</td><td>1 in 100 nights</td><td>Bad-debt line at current LLTV</td><td>Supported LLTV (frozen, 1.5× margin)</td></tr>
        </thead>
        <tbody>
          {d.tokens.map((t) => (
            <tr key={t.token}>
              <td>{t.token}</td>
              <td>
                <span className="mono">−{t.history.worstFallPct}%</span>
                <div className="small muted">{t.history.worst[0]?.date} ({t.history.worst[0]?.kind}) · {t.history.nights.toLocaleString()} nights since {t.history.from}</div>
              </td>
              <td className="mono">−{t.history.p99FallPct}%</td>
              <td className="mono">{lp(t.currentLltv)} → −{line(t.currentLltv)}%</td>
              <td className={t.recommended.frozenFullHistory != null && t.recommended.frozenFullHistory >= t.currentLltv ? "up" : "down"}>{lp(t.recommended.frozenFullHistory)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <b>With Nightshift tracking the night</b> (last ~2 years, {d.tokens.map((t) => `${t.token} ${t.nightshiftWindow.nights}`).join(", ")} nights), the jump left at the open shrinks:
      </p>
      <table className="contracts">
        <thead>
          <tr><td>Token</td><td>Average jump: frozen → Nightshift</td><td>Worst fall: frozen → Nightshift</td></tr>
        </thead>
        <tbody>
          {d.tokens.map((t) => (
            <tr key={t.token}>
              <td>{t.token}</td>
              <td className="mono">{t.nightshiftWindow.frozen.meanAbsPct}% → {t.nightshiftWindow.nightshift.meanAbsPct}%</td>
              <td className="mono">−{t.nightshiftWindow.frozen.worstFallPct}% → −{t.nightshiftWindow.nightshift.worstFallPct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <b>Reading it:</b> 77% for SPY and QQQ holds even if the oracle froze, against every gap since 2005 including March 2020. GLD could
        carry 86%. IBIT&apos;s 62.5% does <i>not</i> clear the 1.5× margin on a frozen price: the weekend into Aug 5, 2024 opened 20% down. That is
        inside its 29.6% bad-debt line, but without the 1.5× margin. It relies on Nightshift tracking bitcoin overnight, so it stays at 62.5% and is the first market
        to lower if price updates stop. Two years of Nightshift tracking would justify much higher LLTVs, but that window is too short to
        lend against, so the frozen-price result sets the limit.
      </p>
      {d.morphoTokenizedMarkets.length > 0 && (
        <>
          <p><b>Live Morpho markets with tokenized stocks or ETFs as collateral</b> (from Morpho&apos;s API, over $1,000 supplied):</p>
          <table className="contracts">
            <thead>
              <tr><td>Collateral</td><td>Chain</td><td>Loan</td><td>LLTV</td><td>Supplied</td></tr>
            </thead>
            <tbody>
              {d.morphoTokenizedMarkets.map((m, i) => (
                <tr key={i}>
                  <td>{m.collateral} <span className="small muted">{m.name}</span></td>
                  <td>{CHAINS[m.chainId] ?? m.chainId}</td>
                  <td>{m.loan}</td>
                  <td className="mono">{lp(m.lltv)}</td>
                  <td className="mono">${m.supplyUsd.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Most tokenized-stock markets use 62.5%, with a few at 86% and some at 38.5%. Nightshift&apos;s 77% for the broad index and gold
            ETFs sits between them, and the gap history above is the reason.
          </p>
        </>
      )}
      <p className="small muted">
        {d.method.rule} {d.method.caveats.join(" ")} Full data: <a href="/verified/lltv-study.json">lltv-study.json</a>. Reproduce with{" "}
        <code>node scripts/lltv-study.mjs</code>.
      </p>
    </div>
  );
}

function MorphoMarkets() {
  const m = DEPLOYMENT.morpho;
  if (!m) return null;
  return (
    <div className="docs-box">
      <p>
        <b>Live on Morpho Blue:</b> real Morpho markets on Base, created{" "}
        {new Date(m.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}, priced by
        Nightshift&apos;s adapters, with Morpho&apos;s AdaptiveCurveIrm. They use demo tokens with no value. Morpho markets have no owner.
      </p>
      <table className="contracts">
        <thead>
          <tr><td>Collateral / loan</td><td>LLTV</td><td>Market</td></tr>
        </thead>
        <tbody>
          {Object.entries(m.markets).map(([s, x]) => (
            <tr key={s}>
              <td>{sym(s)} / {sym("USDG")}</td>
              <td className="mono">{+(x.lltv * 100).toFixed(1)}%</td>
              <td className="mono">
                <a href={`https://app.morpho.org/base/market/${x.id}`} target="_blank" rel="noopener noreferrer">{x.id.slice(0, 10)}…{x.id.slice(-6)} ↗</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {m.e2e?.length ? (
        <p className="small muted">
          End-to-end loan on Morpho:{" "}
          {m.e2e.map((t, i) => (
            <span key={t.hash}>
              {i ? " → " : ""}
              <a href={txUrl(t.hash)} target="_blank" rel="noopener noreferrer">{t.label}</a>
            </span>
          ))}
          .
        </p>
      ) : null}
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
                500 or Nasdaq-100 futures, gold futures, or Bitcoin for IBIT) scaled by a measured beta, Asian and European markets, short-term
                momentum of the anchor, and the crypto Fear &amp; Greed index. The fair value is the weighted average of the signals&apos;
                estimates. Weights are learned from how accurately each signal predicted recent opens, and always stay positive and sum to 100%
                (proven, properties O1a and O1b).
              </p>
              <p>
                Confidence runs from 35 to 98 (proven, O3): <code>clamp(35, 98, 98 − 0.3·hours closed − 0.5·signal disagreement − 10·simulated)</code>.
                Two caps can then lower it further, never below 35, so the proven properties still hold: <b>event mode</b> (a move of 3% or more
                while the market is closed, 3.5% for QQQ and 7% for IBIT, caps it at 70; twice that caps it at 55) and <b>stale anchor data</b>{" "}
                (no anchor update for 2 hours while it should be trading caps it at 60). A foreign market with no data for 4 days drops out of the
                blend. Caps are shown on the Oracle page and in the API.
              </p>
              <p>
                <b>Data:</b> Yahoo Finance first, then Twelve Data as a second source (see live status above). If both fail, the Oracle uses
                clearly labelled simulated data, and simulated prices are never pushed on-chain. <b>Frequency:</b> fair values are recomputed on
                request from data cached for 2 minutes (hourly bars) and 10 minutes (daily bars). <b>On-chain:</b> a keeper runs every 10 minutes
                and pushes a price when it has moved more than 0.1% or is older than 10 minutes. The Oracle contract skips any single update that
                moves a price more than 15% (<code>PriceSkipped</code>); only the owner can force such a move.
              </p>
            </Now>
            <Next>
              <p>The news signal (switched off today) and a second keeper operator.</p>
            </Next>
          </Q>

          <Q id="beta" q="How are betas estimated (Blume adjustment, recalculation, low R²)?">
            <Now>
              <p>
                <b>The ETF tokens</b> use a <b>measured overnight beta</b>: ordinary least squares of the ETF&apos;s open-versus-previous-close
                move on the anchor&apos;s move over the same night, across the last ~20 nights, then the Blume adjustment{" "}
                <code>β = 0.67·β_raw + 0.33</code>, clamped to 0.5–1.5. With fewer than 10 nights, or R² below 0.3, it falls back to 1.0 and
                says so. Betas are recalculated on every Oracle refresh. The graded track record measures each day&apos;s beta from earlier
                sessions only, so it has no look-ahead.
              </p>
              <BetaTable />
              <p>
                <b>Finding:</b> the measured betas are close to 1 with R² above 0.95, so the earlier fixed 1.0 was a good assumption; measuring
                it changed the graded accuracy by a fraction of a basis point. It is now published rather than assumed.
              </p>
              <p>
                <b>Top Stocks (display only, not used for lending)</b> estimate each stock&apos;s beta from about three months of daily returns
                against SPY or QQQ with the same Blume adjustment (clamped 0.3–3; 15+ overlapping days, otherwise 1 with R² 0.3). A low R²
                lowers confidence by (1 − R²)×25 points.
              </p>
            </Now>
            <Next>
              <p>A longer measurement window, and a sector-ETF blend for low-R² stocks.</p>
            </Next>
          </Q>

          <Q id="api" q="What's the public API, and can other protocols consume the feed directly?">
            <Now>
              <p><b>REST, versioned (v1):</b> fields are only ever added within v1. Responses are cached at the edge for 60 seconds; uncached requests are limited to 60 per minute per IP (per server instance unless a shared store is configured).</p>
              <ul>
                <li><code>GET /api/v1/prices</code>: all assets with fair value, confidence, beta, confidence caps, signals and on-chain feed addresses</li>
                <li><code>GET /api/v1/prices/SPY</code>: one asset</li>
                <li><code>GET /api/v1/history?token=SPY&amp;range=12H</code>: fair-value history (1H, 4H, 12H, 24H)</li>
                <li><code>GET /api/v1/track-record</code>: predicted versus actual opens, last 10 sessions</li>
              </ul>
              <p>
                <b>On-chain (Base):</b> <code>NightshiftOracle.getPrice(token)</code> returns price, confidence and update time. Each token
                also has a <b>Chainlink-style feed</b> (<code>AggregatorV3Interface</code>: <code>latestRoundData()</code>, 8 decimals, plus{" "}
                <code>confidence()</code>; there is no round history, so <code>getRoundData</code> answers only the latest round) and a{" "}
                <b>Morpho Blue oracle</b> (<code>price()</code> at Morpho&apos;s 10³⁶ scale) that refuses prices older than one day.
              </p>
              {isDeployed && (
                <table className="contracts">
                  <tbody>
                    <tr>
                      <td>NightshiftOracle</td>
                      <td className="mono">{link(DEPLOYMENT.contracts.oracle)}</td>
                    </tr>
                    {tokens.flatMap(([s, t]) => [
                      ...(t.feed ? [<tr key={`${s}-feed`}><td>{sym(s)} / USD feed (Chainlink-style)</td><td className="mono">{link(t.feed)}</td></tr>] : []),
                      <tr key={`${s}-adapter`}><td>{sym(s)} Morpho oracle</td><td className="mono">{link(t.adapter)}</td></tr>,
                    ])}
                  </tbody>
                </table>
              )}
            </Now>
            <Next>
              <p>Round history for the Chainlink-style feeds, and API keys for higher limits.</p>
            </Next>
          </Q>

          <Q id="gaps" q="How are weekends, holidays and big overnight news handled?">
            <Now>
              <p>
                While markets are closed, confidence falls 0.3 points per hour, and lower confidence shrinks how much can be borrowed. IBIT
                follows Bitcoin through the weekend. NYSE holidays and 1:00 pm early closes (2026–2027 calendar) are built in. <b>Event mode</b>{" "}
                caps confidence when a fair value moves sharply while the market is closed (above), which tightens borrow limits automatically.
              </p>
              <p>
                <b>News:</b> a news signal (an AI model scoring the latest headlines) is built but switched off, so a news event reaches the
                Oracle through futures and other markets, and through event mode when the move is large. The 15% per-update cap on-chain limits
                how far one bad print can move a price.
              </p>
            </Now>
            <Next>
              <p>Switch the news signal on.</p>
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
                itself is not formally verified. The Oracle&apos;s event and staleness caps sit on top of the proven confidence formula; they can
                only lower confidence and keep it within 35–98, so O2, O2b and O3 still hold. The mapping and known gaps are in{" "}
                <a href="/verified/src/MAPPING.md">MAPPING.md</a>.
              </p>
            </Now>
            <p>
              <b>Re-check it yourself:</b> the proofs are public at{" "}
              <a href="https://github.com/nightshift-labs007/nightshift-formal" target="_blank" rel="noopener noreferrer">github.com/nightshift-labs007/nightshift-formal ↗</a>{" "}
              with four commands to rebuild them with Lean, confirm every theorem uses only Lean&apos;s standard axioms, and match the
              fingerprint on Algorand. The same checks run in that repository&apos;s public CI on every change.
            </p>
            <Next>
              <p>Formal models of the new on-chain pieces (confidence decay, the Cloak registry&apos;s checks).</p>
            </Next>
          </Q>

          <Q id="audit" q="Are the contracts audited?">
            <Now>
              <p>
                No independent audit yet. The contracts were scanned with Slither, the standard open-source Solidity analyzer. Two real issues
                were found and fixed in the current deployment; the rest are intended or known false positives:
              </p>
              <SlitherSummary />
              <p>
                Other assurance: the formal proofs, contract tests, the model-versus-contract checks, Guardian fuzzing (below) and
                Sourcify-verified source code. That is why every page labels the Vault an unaudited demo with assets of no value.
              </p>
            </Now>
            <Next>
              <p>
                An external audit before any real assets. The scope, roles and trust assumptions, invariants, known issues and a production
                checklist are written up for audit firms: <a href="/verified/audit-scope.md">audit-scope.md</a>.
              </p>
            </Next>
          </Q>

          <Q id="guardian-proofs" q="What exactly is proven about the Guardian, and has it been tested against adversarial prices?">
            <Now>
              <p>
                Proven: the collateral used is never negative (G1) and never more than you have (G2); the loan lands exactly on your target
                health (G3); any smaller amount would miss the target (G3b); if using collateral can&apos;t help, the Guardian does nothing (G4);
                and it only acts on loans that can still be saved (G5).
              </p>
              <p>
                <b>Fuzzed:</b> the real Vault contract runs through thousands of random and adversarial price paths (normal moves, slow bleeds,
                ±5–30% gaps, recoveries) with a random loan size, LLTV, borrow level, trigger and target. After every move the test checks each
                rule above against what the contract actually did:
              </p>
              <FuzzSummary />
            </Now>
            <Next>
              <p>Longer and multi-collateral runs on every contract change, as part of continuous integration.</p>
            </Next>
          </Q>

          <h2 className="docs-h" id="lending">Vault, Guardian and lending</h2>

          <Q id="morpho" q="Is the Vault a live Morpho Blue market?">
            <Now>
              <MorphoMarkets />
              <p>
                The Vault itself is not a Morpho market: it is Nightshift&apos;s own contract on Base that follows Morpho Blue&apos;s rules (health factor, LLTV, liquidation
                incentive). The Morpho oracles listed above were tested against the real Morpho Blue contract on a fork of Base: the market was
                created, borrowing to the limit worked, one unit more was refused, and a 20% price drop made the loan liquidatable. They now also
                refuse prices older than one day.
              </p>
            </Now>
            <Next>
              <p>A demo market on Morpho Blue on Base; then a market with a licensed tokenized-ETF collateral and a real loan asset, listed by a Morpho curator, after an audit.</p>
            </Next>
          </Q>

          <Q id="keeper" q="How does the Guardian keeper work in practice, and what if it's offline?">
            <Now>
              <p>
                You set a rule per loan: alert only, or auto-protect with a trigger (for example 1.15) and a target (for example 1.40). Every 10
                minutes the keeper checks every loan with a rule and calls <code>protect()</code> when 1 ≤ health &lt; trigger. A rebalance in
                this demo means the Vault takes just enough collateral at the Oracle price minus 0.5% and cancels the same value of debt; nothing
                is traded on a DEX. <code>protect()</code> is permissionless, so anyone can run a keeper.
              </p>
              <p>
                <b>Alerts</b> appear in the app as banners and pop-ups, and as browser notifications if you allow them, while the page is
                open. <b>Gas:</b> default pricing with explicit transaction ordering.
              </p>
              <p>
                <b>Failure modes:</b> if the keeper is offline, nobody rebalances loans, and once health falls below 1 anyone can liquidate.
                If a rebalance can&apos;t reach the target, the contract refuses and the app shows an alert. If price updates stop, the
                confidence the Vault uses falls 1 point per hour on-chain, shrinking borrow limits and stopping new borrowing below 40; after 2
                days the Vault refuses the price entirely. Every state-changing Vault function has a reentrancy guard.
              </p>
            </Now>
            <Next>
              <p>Email and Telegram alerts, a public keeper heartbeat page, a gas ceiling with retries, and DEX-routed rebalancing in production.</p>
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
              <p><b>Why these numbers:</b> every close-to-open gap since 2005, and how they compare with live Morpho markets:</p>
              <LltvStudy />
            </Now>
            <Next>
              <p>Re-run the study quarterly, and lower IBIT&apos;s LLTV automatically if Nightshift&apos;s price updates stop.</p>
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
                the market.{" "}
                {DEPLOYMENT.contracts.cloakRegistry ? (
                  <>
                    On Base, the <b>CloakRegistry</b> contract ({link(DEPLOYMENT.contracts.cloakRegistry)}) enforces all three on-chain: the
                    Groth16 proof must be valid, its price must match NightshiftOracle within 1% (from a price less than a day old), and its LLTV
                    must match the Vault market. <code>check()</code> is a free read; <code>attest()</code> records an accepted proof by its
                    commitment. &ldquo;Verify on-chain&rdquo; in the app uses it.
                  </>
                ) : (
                  <>&ldquo;Verify on-chain&rdquo; has the Groth16 verifier contract on Base check the math, then compares the proof&apos;s price and LLTV with the on-chain Oracle and Vault.</>
                )}
              </p>
              <p><b>Not yet:</b> proofs of a specific health level, binding a proof to a specific Vault position, and a multi-party trusted setup (today&apos;s setup was run by one party).</p>
            </Now>
            <Next>
              <p>Optional &ldquo;health ≥ X&rdquo; proofs, position binding, and a multi-party setup ceremony.</p>
            </Next>
          </Q>
        </div>
      </section>
    </PageShell>
  );
}
