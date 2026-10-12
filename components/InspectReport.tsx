"use client";

import type { OracleSnapshot } from "@/lib/oracle";
import type { StockBoard, StockQuote } from "@/lib/stocks";
import { isDeployed } from "@/lib/chain";
import { SiteNav } from "./Site";
import { StockLogo, StockTable } from "./Stocks";
import { signed, usd, useApi } from "./useApi";

const cls = (x: number) => (x >= 0 ? "up" : "down");
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function Kpi({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "up" | "down" }) {
  return (
    <div className="card stat">
      <span className="unit">{label}</span>
      <div className={`v ${tone ?? ""}`}>{value}</div>
      {sub && <p className="ins-sub">{sub}</p>}
    </div>
  );
}

function Mover({ q }: { q: StockQuote }) {
  return (
    <a className="ins-mover" href={`#${q.ticker}`}>
      <StockLogo q={q} size={26} />
      <b>{q.ticker}</b>
      <span className={`mono ${cls(q.driftPct)}`}>{signed(q.driftPct)}</span>
    </a>
  );
}

function takeaways(board: StockBoard, snap: OracleSnapshot | null): string[] {
  const s = board.stocks;
  const out: string[] = [];
  if (board.market.open) {
    out.push("Wall Street is open, so every price here is the live market price. The engine switches to overnight estimates at 4:00 PM ET.");
  }
  const nq = board.futures.find((f) => f.symbol === "NQ=F");
  const es = board.futures.find((f) => f.symbol === "ES=F");
  if (!board.market.open && nq && es) {
    const dir = nq.movePct + es.movePct >= 0 ? "higher" : "lower";
    out.push(
      `Futures point ${dir}: Nasdaq-100 futures are ${signed(nq.movePct)} and S&P 500 futures ${signed(es.movePct)} since the last close. Nightshift carries that move into each stock in proportion to its beta.`,
    );
    const byDrift = [...s].sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct));
    const top = byDrift.slice(0, 3);
    out.push(`The largest expected moves at the open are ${top.map((q) => `${q.name} (${signed(q.driftPct)})`).join(", ")}: high-beta names amplify the futures move.`);
    const calm = byDrift.slice(-3).reverse();
    out.push(`The quietest are ${calm.map((q) => q.name).join(", ")}, whose prices historically follow the index the least.`);
  }
  const withExt = s.filter((q) => q.extended);
  if (!board.market.open && withExt.length) {
    out.push(
      `${withExt.length} of ${s.length} stocks have a pre- or after-hours trade. The typical gap between that trade and Nightshift's value is ${median(withExt.map((q) => Math.abs(q.extended!.vsFairBps))).toFixed(0)} basis points. Those trades can be hours old and thin, which is exactly why a continuous estimate is useful.`,
    );
  }
  const hot = [...s].sort((a, b) => b.vol30Pct - a.vol30Pct)[0];
  if (hot) out.push(`${hot.name} is the most volatile name tracked (about ${hot.vol30Pct.toFixed(0)}% a year), so a lender would want the widest safety margin on it.`);
  if (snap) {
    const conf = Math.round(avg(snap.quotes.map((q) => q.confidence)));
    out.push(`The Oracle's average confidence on its ETF tokens is ${conf}/100. Lower confidence automatically tightens borrowing limits in the Vault.`);
  }
  return out;
}

export function InspectReport() {
  const { data: board } = useApi<StockBoard>("/api/stocks", 120_000);
  const { data: snap } = useApi<OracleSnapshot>("/api/oracle", 60_000);

  const s = board?.stocks ?? [];
  const up = s.filter((q) => q.driftPct > 0.005).length;
  const down = s.filter((q) => q.driftPct < -0.005).length;
  const sectors = [...new Set(s.map((q) => q.sector))]
    .map((sec) => ({ sec, move: avg(s.filter((q) => q.sector === sec).map((q) => q.driftPct)), n: s.filter((q) => q.sector === sec).length }))
    .sort((a, b) => b.move - a.move);
  const maxAbs = Math.max(0.05, ...sectors.map((x) => Math.abs(x.move)));
  const byDrift = [...s].sort((a, b) => b.driftPct - a.driftPct);
  const topBeta = [...s].sort((a, b) => b.beta - a.beta)[0];
  const ext = s.filter((q) => q.extended);

  return (
    <>
      <SiteNav />

      <main className="ins-enter">
        <section className="block ins-hero">
          <div className="wrap">
            <p className="overline-plain mono">ENGINE INSPECTION · {board ? board.market.etTime.toUpperCase() : "LOADING"}</p>
            <h1>Inside the Nightshift engine</h1>
            <p className="lead">
              What the engine is doing right now, and its live read on the world&apos;s largest stocks while Wall Street is closed. Every number on this page is recomputed from
              live market data every one to two minutes.
            </p>
          </div>
        </section>

        <section className="block" id="now">
          <div className="wrap">
            <header className="section-head">
              <div>
                <p className="overline">Right now</p>
                <h2>What the engine is doing</h2>
              </div>
            </header>
            <ol className="ins-steps">
              <li className="card">
                <span className="mono ins-n">01</span>
                <h3>Reading markets that never sleep</h3>
                <p>
                  {board?.futures.length
                    ? board.futures.map((f) => `${f.name} ${signed(f.movePct)}`).join(" · ") + " since the last close."
                    : "Index futures, Bitcoin, Asian and European indices, and market sentiment."}
                  {snap?.fearGreed ? ` Crypto Fear & Greed ${snap.fearGreed.value} (${snap.fearGreed.label}).` : ""}
                </p>
              </li>
              <li className="card">
                <span className="mono ins-n">02</span>
                <h3>Pricing the ETF tokens</h3>
                <div className="ins-tokens">
                  {(snap?.quotes ?? []).map((q) => (
                    <div key={q.token}>
                      <b className="mono">{q.token}</b>
                      <span>{usd(q.fairValue)}</span>
                      <span className={`mono ${cls(q.driftPct)}`}>{signed(q.driftPct)}</span>
                      <span className="mono ins-dim">conf {q.confidence}</span>
                    </div>
                  ))}
                </div>
              </li>
              <li className="card">
                <span className="mono ins-n">03</span>
                <h3>Estimating {s.length || 20} large-cap stocks</h3>
                <p>
                  {board
                    ? board.market.open
                      ? "Market open: following live prices."
                      : `${up} expected to open higher, ${down} lower. Average implied move ${signed(avg(s.map((q) => q.driftPct)))}.`
                    : "Loading…"}
                </p>
              </li>
              <li className="card">
                <span className="mono ins-n">04</span>
                <h3>Guarding loans, proving, recording</h3>
                <p>
                  Guardian checks every loan on each update ({isDeployed ? "on-chain on Base" : "paper mode; on-chain contracts built and tested"}). Cloak
                  proofs are verified live. Ledger stamps predictions on Algorand before each open.
                </p>
              </li>
            </ol>
          </div>
        </section>

        <section className="block alt" id="analysis">
          <div className="wrap">
            <header className="section-head">
              <div>
                <p className="overline">Stock analysis</p>
                <h2>Overnight read on the top stocks</h2>
                <p className="lead">Where Nightshift expects each stock to open, how sure it is, and what drives the estimate.</p>
              </div>
            </header>
            {!board ? (
              <div className="skeleton">Loading live analysis…</div>
            ) : (
              <>
                <div className="ins-kpis">
                  <Kpi label="Breadth" value={`${up} ↑ · ${down} ↓`} sub={`of ${s.length} stocks, implied by futures`} />
                  <Kpi label="Average implied move" value={signed(avg(s.map((q) => q.driftPct)))} tone={cls(avg(s.map((q) => q.driftPct)))} sub="vs last close" />
                  <Kpi label="Most sensitive" value={topBeta ? topBeta.ticker : "—"} sub={topBeta ? `beta ${topBeta.beta.toFixed(2)} to its index` : ""} />
                  <Kpi
                    label="After-hours check"
                    value={ext.length ? `${median(ext.map((q) => Math.abs(q.extended!.vsFairBps))).toFixed(0)} bps` : "—"}
                    sub={ext.length ? `median gap to latest extended trade (${ext.length} stocks)` : "no extended-hours trades yet"}
                  />
                </div>

                <div className="ins-grid">
                  <div className="card panel">
                    <h3>Expected to open highest</h3>
                    <div className="ins-movers">{byDrift.slice(0, 5).map((q) => <Mover key={q.ticker} q={q} />)}</div>
                    <h3 style={{ marginTop: 18 }}>Expected to open lowest</h3>
                    <div className="ins-movers">{byDrift.slice(-5).reverse().map((q) => <Mover key={q.ticker} q={q} />)}</div>
                  </div>
                  <div className="card panel">
                    <h3>Implied move by sector</h3>
                    <div className="ins-bars">
                      {sectors.map((x) => (
                        <div key={x.sec} className="ins-bar">
                          <span>
                            {x.sec} <small className="ins-dim">({x.n})</small>
                          </span>
                          <i>
                            <em className={cls(x.move)} style={{ width: `${(Math.abs(x.move) / maxAbs) * 100}%` }} />
                          </i>
                          <b className={`mono ${cls(x.move)}`}>{signed(x.move)}</b>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="card panel ins-take">
                  <h3>Takeaways</h3>
                  <ul>
                    {takeaways(board, snap).map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="block" id="all">
          <div className="wrap">
            <header className="section-head">
              <div>
                <p className="overline">All stocks</p>
                <h2>Every stock the engine tracks</h2>
                <p className="lead">Click a column to sort.</p>
              </div>
            </header>
            {board ? <StockTable stocks={board.stocks} /> : <div className="skeleton">Loading…</div>}
          </div>
        </section>

        <section className="block alt" id="method">
          <div className="wrap ins-method">
            <header className="section-head">
              <div>
                <p className="overline">Method</p>
                <h2>How the stock estimates are made</h2>
              </div>
            </header>
            <div className="ins-grid">
              <div className="card panel">
                <h3>The estimate</h3>
                <pre className="code">fair value = last close × (1 + β × futures move since close)</pre>
                <p>
                  Tech names follow Nasdaq-100 futures; the rest follow S&amp;P 500 futures. β (beta) is each stock&apos;s measured sensitivity to its index over the last three
                  months, adjusted toward 1 (the Blume adjustment) because short-window betas are noisy.
                </p>
              </div>
              <div className="card panel">
                <h3>Confidence</h3>
                <pre className="code">97 − 0.3 × hours since close − 25 × (1 − R²)</pre>
                <p>
                  Confidence falls the longer the market has been closed, and for stocks whose daily moves the index explains poorly (low R²), since company news drives them
                  more. While the market is open, prices are live and confidence is 99.
                </p>
              </div>
            </div>
            <p className="ins-dim ins-note">
              Data: Yahoo Finance (delayed, unofficial). Estimates are data, not investment advice. Company names and logos identify the stocks only and imply no endorsement or partnership.
            </p>
          </div>
        </section>
      </main>
    </>
  );
}
