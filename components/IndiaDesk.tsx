"use client";

import { useState } from "react";
import type { Baseline, Estimate, Study } from "@/lib/india/backtest";
import type { Category, Radar } from "@/lib/india/news";
import { marketById } from "@/lib/markets";
import { Flag } from "./Flag";
import { WaitlistForm } from "./Markets";
import { SectionHead } from "./Site";
import { useApi } from "./useApi";

type Research = {
  updatedAt: string;
  board: { key: string; name: string; date: string; close: number; change: number }[];
  baseline: Baseline;
  studies: Study[];
  active: string[];
  estimate: Estimate | null;
};

const pct = (x: number, d = 2) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(d)}%`;
const arrow = (x: number) => (x > 0.0005 ? "▲" : x < -0.0005 ? "▼" : "•");
const num = (x: number) => x.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const DRIVER_NAMES = { spx: "S&P 500", crude: "Crude oil", gold: "Gold", usdinr: "USD/INR" } as const;
const FAMILY = { geopolitical: "Geopolitical", global: "Global", currency: "Currency", fear: "Volatility", momentum: "Momentum" } as const;
const CATEGORY: Record<Category, string> = { geopolitical: "Geopolitical", policy: "Political & policy", global: "Global", markets: "Markets" };

function ago(t: number | null) {
  if (!t) return "";
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 60 ? `${m}m ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
}

function EstimateCard({ e }: { e: Estimate }) {
  return (
    <div className="card panel in-estimate">
      <div>
        <span className="unit">Pre-open estimate · Nifty 50</span>
        {e.next ? (
          <>
            <strong className={e.next.gap >= 0 ? "up" : "down"}>
              {arrow(e.next.gap)} {pct(e.next.gap)}
            </strong>
            <p>
              Expected opening gap for the next session after the {fmtDay(e.next.after)} close, around <b>{num(Math.round(e.next.level))}</b>.
            </p>
          </>
        ) : (
          <p>Waiting for overnight data.</p>
        )}
      </div>
      {e.next && (
        <ul className="in-drivers">
          {(Object.keys(DRIVER_NAMES) as (keyof typeof DRIVER_NAMES)[]).map((k) => {
            const v = e.next!.drivers[k];
            return (
              <li key={k}>
                <span>{DRIVER_NAMES[k]}</span>
                <b className={v !== null && v >= 0 ? "up" : "down"}>{v === null ? "—" : `${arrow(v)} ${pct(v)}`}</b>
              </li>
            );
          })}
        </ul>
      )}
      <div className="in-record">
        <div>
          <span className="unit">Direction right</span>
          <b>{Math.round(e.directionHit * 100)}%</b>
          <small>of the last 250 opens that moved 0.1%+</small>
        </div>
        <div>
          <span className="unit">Average miss</span>
          <b>{e.maeBps.toFixed(0)} bps</b>
          <small>vs {e.naiveMaeBps.toFixed(0)} bps for &ldquo;no change&rdquo;</small>
        </div>
      </div>
      <p className="xs muted">
        Fitted walk-forward: each day&apos;s estimate uses only data from before it. The S&amp;P 500 carries most of the weight (a 1% US move ≈{" "}
        {(e.coefficients.spx * 100).toFixed(0)} bps on the Nifty open). GIFT Nifty futures would sharpen this; they aren&apos;t in the free data.
      </p>
    </div>
  );
}

function StudyCard({ s, base, active }: { s: Study; base: Baseline; active: boolean }) {
  return (
    <article className={`card in-study ${active ? "active" : ""}`}>
      <header>
        <span className={`in-family ${s.family}`}>{FAMILY[s.family]}</span>
        <span className={`in-strength ${s.strength.replace(" ", "-")}`}>{s.strength === "too few" ? "Too few events" : `${s.strength[0].toUpperCase()}${s.strength.slice(1)} pattern`}</span>
      </header>
      <h3>
        {active && <i className="in-live" aria-label="Active now" />}
        {s.name}
      </h3>
      <p className="in-rule">{s.rule}</p>
      <div className="in-stats">
        <div>
          <span className="unit">Next day</span>
          <b className={s.avgDay >= 0 ? "up" : "down"}>
            {arrow(s.avgDay)} {pct(s.avgDay)}
          </b>
        </div>
        <div>
          <span className="unit">Red days</span>
          <b>{Math.round(s.downDayPct * 100)}%</b>
          <small>usually {Math.round(base.downDayPct * 100)}%</small>
        </div>
        <div>
          <span className="unit">5 days</span>
          <b className={(s.avgWeek ?? 0) >= 0 ? "up" : "down"}>{s.avgWeek === null ? "—" : `${arrow(s.avgWeek)} ${pct(s.avgWeek)}`}</b>
        </div>
      </div>
      <p className="in-timing">
        <b>When it moves:</b> {pct(s.avgGap)} at the open, {pct(s.avgIntraday)} after it.{" "}
        {Math.abs(s.avgGap) > 2 * Math.abs(s.avgIntraday) ? "Most of the reaction is priced in by 09:15." : "The move keeps building after the open."}
      </p>
      <p className="in-why">{s.why}</p>
      <p className="xs muted">
        {s.events} events since {fmtDay(base.from)} {new Date(`${base.from}T12:00:00Z`).getUTCFullYear()}
        {s.recent[0] ? ` · last: ${fmtDay(s.recent[0].date)} (${pct(s.recent[0].day)})` : ""}
      </p>
    </article>
  );
}

function RadarPanel({ r }: { r: Radar }) {
  const [cat, setCat] = useState<Category | "all">("all");
  const items = r.items.filter((x) => cat === "all" || x.category === cat).slice(0, 14);
  const level = r.risk >= 70 ? "High" : r.risk >= 40 ? "Elevated" : r.risk >= 20 ? "Moderate" : "Calm";
  return (
    <div className="in-radar">
      <div className="card panel in-risk">
        <span className="unit">Geopolitical &amp; political risk</span>
        <strong>{Math.round(r.risk)}</strong>
        <div className="in-meter" aria-hidden="true">
          <i style={{ width: `${Math.max(3, r.risk)}%` }} />
        </div>
        <b>{level}</b>
        <p>{r.brief ?? "Keyword estimate from the last 24 hours of headlines. Set an Anthropic key to have Claude score each headline and write a brief."}</p>
        <p className="xs muted">
          {r.items.length} headlines · {Object.entries(r.sources).map(([k, v]) => `${k} ${v}`).join(" · ")}
          {r.model ? ` · scored by ${r.model}` : " · keyword scoring"}
        </p>
      </div>
      <div className="in-news">
        <div className="seg in-tabs" role="tablist">
          {(["all", "geopolitical", "policy", "global", "markets"] as const).map((c) => (
            <button key={c} role="tab" aria-selected={cat === c} className={cat === c ? "on" : ""} onClick={() => setCat(c)}>
              {c === "all" ? "All" : CATEGORY[c]}
            </button>
          ))}
        </div>
        <ul>
          {items.map((x) => (
            <li key={x.link}>
              <span className={`in-impact ${x.impact > 0.15 ? "pos" : x.impact < -0.15 ? "neg" : ""}`} title="Likely effect on the Nifty, from -1 to +1">
                {x.impact > 0.15 ? "▲" : x.impact < -0.15 ? "▼" : "•"}
              </span>
              <div>
                <a href={x.link} target="_blank" rel="noopener noreferrer">
                  {x.title}
                </a>
                {x.why && <p>{x.why}</p>}
                <small>
                  {CATEGORY[x.category]} · {x.source.replace(" · via Google News", "")} {x.at ? `· ${ago(x.at)}` : ""}
                  {x.sectors.length ? ` · ${x.sectors.join(", ")}` : ""}
                </small>
              </div>
            </li>
          ))}
          {!items.length && <li className="muted">No headlines in this category in the last 24 hours.</li>}
        </ul>
      </div>
    </div>
  );
}

/** India research desk: pre-open estimate, backtested condition studies and the news radar. Research, not advice. */
export function IndiaDesk() {
  const { data, error } = useApi<Research>("/api/india", 600_000);
  const { data: radar } = useApi<Radar>("/api/india/news", 600_000);
  const india = marketById("india")!;
  const active = new Set(data?.active ?? []);
  const studies = data ? [...data.studies].sort((a, b) => Number(active.has(b.id)) - Number(active.has(a.id)) || Math.abs(b.t) - Math.abs(a.t)) : [];

  return (
    <>
      <section className="block">
        <div className="wrap">
          {data ? (
            <>
              <div className="in-board">
                {data.board.map((b) => (
                  <div key={b.key} className="card in-tile">
                    <span className="unit">{b.name}</span>
                    <b>{num(b.close)}</b>
                    <span className={b.key === "usdinr" || b.key === "vix" ? "" : b.change >= 0 ? "up" : "down"}>
                      {arrow(b.change)} {pct(b.change)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="in-top">
                {data.estimate ? <EstimateCard e={data.estimate} /> : <div className="card panel">The pre-open estimate needs more history.</div>}
                <div className="card panel in-now">
                  <span className="unit">Active before the next open</span>
                  {data.active.length ? (
                    data.studies
                      .filter((s) => active.has(s.id))
                      .map((s) => (
                        <div key={s.id} className="in-now-item">
                          <h3>
                            <i className="in-live" /> {s.name}
                          </h3>
                          <p>
                            In {s.events} past cases the Nifty&apos;s next day averaged <b className={s.avgDay >= 0 ? "up" : "down"}>{pct(s.avgDay)}</b> and closed red{" "}
                            {Math.round(s.downDayPct * 100)}% of the time (an ordinary day: {Math.round(data.baseline.downDayPct * 100)}%). {pct(s.avgGap)} of it came at the
                            open.
                          </p>
                        </div>
                      ))
                  ) : (
                    <p>No unusual overnight condition right now. Ordinary days close red {Math.round(data.baseline.downDayPct * 100)}% of the time.</p>
                  )}
                  <p className="xs muted">Historical statistics, not a forecast or a recommendation.</p>
                </div>
              </div>
            </>
          ) : (
            <div className="skeleton">{error ? "Indian market data is unavailable right now." : "Running five years of backtests…"}</div>
          )}
        </div>
      </section>

      <section className="block alt" id="studies">
        <div className="wrap">
          <SectionHead
            overline="Backtests · 5 years of Nifty 50 history"
            title="What usually happens next."
            lead={
              data
                ? `${data.baseline.days.toLocaleString()} trading days from ${fmtDay(data.baseline.from)} ${data.baseline.from.slice(0, 4)}. Each card shows how the Nifty behaved after a condition, against an ordinary day. "Strong" means the difference is unlikely to be chance (more than 2.5 standard errors).`
                : undefined
            }
          />
          <div className="in-studies">
            {data && studies.map((s) => <StudyCard key={s.id} s={s} base={data.baseline} active={active.has(s.id)} />)}
          </div>
        </div>
      </section>

      <section className="block" id="radar">
        <div className="wrap">
          <SectionHead overline="Radar · last 24 hours" title="Geopolitics and politics, filtered for markets." lead="Indian business feeds, Google News and GDELT, de-duplicated, with broker tips removed. Headlines and links only." />
          {radar ? <RadarPanel r={radar} /> : <div className="skeleton">Reading the news…</div>}
        </div>
      </section>

      <section className="block alt" id="timing">
        <div className="wrap">
          <SectionHead overline="Timing" title="When the information arrives." />
          <ol className="in-clock">
            <li><b>02:30 IST</b> (01:30 in US summer time): US markets close. The overnight drivers are final and the estimate above stops moving.</li>
            <li><b>09:00–09:08 IST</b>: NSE pre-open order entry. The opening price is discovered here.</li>
            <li><b>09:15 IST</b>: the open. For US-driven conditions, the backtests show almost all of the reaction is already in the opening price.</li>
            <li><b>15:30 IST</b>: the close. Volatility-spike and sharp-fall conditions have historically kept moving until here.</li>
          </ol>
        </div>
      </section>

      <section className="block" id="alerts">
        <div className="wrap">
          <div className="card panel market-panel">
            <div className="market-panel-head">
              <span className="market-flag big"><Flag id="india" size={42} /></span>
              <div>
                <span className="unit">Alerts</span>
                <h3>Get these on Telegram or WhatsApp</h3>
              </div>
            </div>
            <p>Pre-open estimates and condition alerts before 09:15 IST are coming to Telegram and WhatsApp. Join the India list to be first.</p>
            <WaitlistForm market={india} />
            <p className="market-legal">
              Research, not advice. Nightshift is not registered with SEBI as an investment adviser or research analyst. Everything here is a historical statistic or a
              classification of public headlines; past patterns can stop working, and none of it is a recommendation to buy, sell or hold any security.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
