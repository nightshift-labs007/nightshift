"use client";

import { GettingStarted } from "./GettingStarted";
import { InfoTip } from "./InfoTip";
import Link from "next/link";
import { useEffect } from "react";
import type { OracleSnapshot } from "@/lib/oracle";
import type { StockBoard } from "@/lib/stocks";
import { isDeployed, isMainnet } from "@/lib/chain";
const LIVE = isDeployed ? (isMainnet ? "Live on Base · demo" : "Live on testnet") : "Testnet-ready";
import { CountUp } from "./CountUp";
import { Earn } from "./Earn";
import { HowItWorks } from "./HowItWorks";
import { Integrations } from "./Integrations";
import { SectionHead, SiteFooter, SiteNav } from "./Site";
import { TopStocks } from "./Stocks";
import { usd, useApi } from "./useApi";

/** The Nightshift engine scene (the city with the live engine), served from /engine. */
function EngineHero() {
  return (
    <section className="engine-hero" id="top" aria-label="Nightshift engine, interactive">
      <iframe src="/engine/index.html" title="Nightshift live engine" allow="autoplay" />
    </section>
  );
}

function MarketStrip({ snap }: { snap: OracleSnapshot | null }) {
  return (
    <div className="market-strip" aria-label="Live Oracle prices">
      <div className="wrap strip-inner">
        {(snap?.quotes ?? []).map((q) => (
          <Link key={q.token} className="strip-item" href="/oracle">
            <span className="strip-token">{q.token}</span>
            <span className="strip-price">
              <CountUp value={q.fairValue} format={(x) => usd(x)} />
            </span>
            <span className={`strip-move ${q.driftPct >= 0 ? "up" : "down"}`}>
              {q.driftPct >= 0 ? "+" : "−"}
              {Math.abs(q.driftPct).toFixed(2)}%
            </span>
            <span className="strip-conf">Conf. {q.confidence} <InfoTip k="confidence" label="Conf." /></span>
          </Link>
        ))}
        <span className="strip-meta">{snap ? `${snap.market.open ? "NYSE open" : "NYSE closed"} · ${snap.market.etTime}` : "Loading prices…"}</span>
      </div>
    </div>
  );
}

const ROADMAP = [
  { phase: "Live", title: "Oracle and shift reports", body: "Off-hours fair values for SPY, QQQ, gold and Bitcoin ETF tokens, a public API, and a graded track record." },
  { phase: LIVE, title: "Vault on Morpho", body: "Smart contracts with Morpho Blue's rules and a Morpho-compatible oracle adapter, on Base. Next: markets on Morpho itself." },
  { phase: LIVE, title: "Guardian", body: "Borrowers opt in on-chain; a keeper protects loans around the clock. Next: alerts by email and Telegram." },
  { phase: "Live proofs", title: "Cloak", body: "Solvency proofs verified by the server and by a smart contract. Next: shielded positions and an auditor view key." },
];

/** Gentle fade-in for sections as they scroll into view. */
function useReveal() {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const reveal = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in-view");
            reveal.unobserve(e.target);
          }
        }),
      { threshold: 0.05 },
    );
    document.querySelectorAll("section.block").forEach((el) => {
      el.classList.add("reveal");
      reveal.observe(el);
    });
    return () => reveal.disconnect();
  }, []);
}

/** Landing page: what Nightshift does, live prices, the stock board and Earn; the app itself lives at /app. */
export function Dashboard() {
  const { data: snap } = useApi<OracleSnapshot>("/api/oracle", 60_000);
  const { data: board } = useApi<StockBoard>("/api/stocks", 120_000);
  useReveal();

  return (
    <>
      <SiteNav />
      <EngineHero />
      <MarketStrip snap={snap} />

      <main>
        <div className="wrap start-wrap">
          <GettingStarted />
        </div>
        <section className="block" id="stocks">
          <div className="wrap">
            <SectionHead
              overline="Top stocks"
              title="The world's biggest stocks, priced after the bell."
              lead="The same engine that prices the ETF tokens estimates where each of these stocks would trade right now, from index futures and each stock's own measured sensitivity to them."
            />
            <TopStocks board={board} />
          </div>
        </section>

        <section className="block" id="how">
          <div className="wrap">
            <SectionHead
              overline="Product"
              title="One live price, and the products built on it."
              lead="The Oracle produces a fair value every minute. The Vault lends against it, the Guardian monitors loans with it, the Cloak proves solvency at it, and the Ledger records it before every open. Earn shows where idle USDG could earn yield."
            />
            <div className="problem-grid">
              <div className="card problem">
                <h3>Prices go stale</h3>
                <p>Tokens trade 24/7, but traditional feeds stop at Friday&apos;s close.</p>
              </div>
              <div className="card problem">
                <h3>Loans are visible</h3>
                <p>Public positions show exactly where a liquidation would trigger.</p>
              </div>
              <div className="card problem">
                <h3>Monday gaps</h3>
                <p>Weekend news reaches prices all at once at the open.</p>
              </div>
            </div>
            <HowItWorks />
          </div>
        </section>

        <section className="block alt" id="integrations">
          <div className="wrap">
            <SectionHead
              overline="Built with"
              title="Five integrations, each doing one job."
              lead="Nightshift prices tokenized ETFs overnight. These protocols make that price provable, usable for lending, private, on the record, and productive."
            />
            <Integrations />
          </div>
        </section>

        <section className="block" id="earn">
          <div className="wrap">
            <SectionHead
              overline="Earn · Sentora"
              title="Idle USDG could earn a protected RWA rate."
              lead="A live, read-only view of a Sentora PYUSD vault: current yield, size and history, with a link to deposit on Sentora. Nightshift never touches your funds."
            />
            <Earn />
          </div>
        </section>

        <section className="block alt" id="roadmap">
          <div className="wrap">
            <SectionHead overline="Roadmap" title="What's live and what's next." />
            <div className="roadmap-grid">
              {ROADMAP.map((r) => (
                <div key={r.title} className="card roadmap-item">
                  <span className={`badge ${r.phase.startsWith("Live") ? "live" : "paper"}`}>{r.phase}</span>
                  <h3>{r.title}</h3>
                  <p>{r.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="cta">
          <div className="wrap cta-inner">
            <div>
              <h2>Markets close. Prices shouldn&apos;t.</h2>
              <p>Borrow against ETF tokens priced overnight, protected by the Guardian, proven by math.</p>
            </div>
            <div className="cta-actions">
              <Link className="btn primary" href="/app">
                Launch app
              </Link>
              <Link className="btn secondary" href="/oracle">
                View live prices
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
