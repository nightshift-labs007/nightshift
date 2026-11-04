"use client";

import Link from "next/link";
import { useEffect } from "react";
import type { OracleSnapshot } from "@/lib/oracle";
import type { StockBoard } from "@/lib/stocks";
import { isDeployed, isMainnet } from "@/lib/chain";
const LIVE = isDeployed ? (isMainnet ? "Live on Base · demo" : "Live on testnet") : "Paper mode";
import { Integrations } from "./Integrations";
import { ProtocolShowcase } from "./ProtocolShowcase";
import { SectionHead, SiteFooter, SiteNav } from "./Site";
import { TopStocks } from "./Stocks";
import { useApi } from "./useApi";

/** The Nightshift engine scene (the city with the live engine), served from /engine. */
function EngineHero() {
  return (
    <section className="engine-hero" id="top" aria-label="Nightshift engine, interactive">
      <iframe src="/engine/index.html" title="Nightshift live engine" allow="autoplay" />
    </section>
  );
}

const ROADMAP = [
  { phase: "Live", title: "Oracle and shift reports", body: "Off-hours fair values for SPY, QQQ, gold and Bitcoin ETF tokens, a public API, and a graded track record." },
  { phase: LIVE, title: "Vault", body: "Lending with Morpho Blue's liquidation rules, live on Base with demo assets, plus a paper account. Next: an audit." },
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

/** Landing page: the engine hero, the stock board, live checks, integrations and the roadmap; the app itself lives at /app. */
export function Dashboard() {
  const { data: snap } = useApi<OracleSnapshot>("/api/oracle", 60_000);
  const { data: board } = useApi<StockBoard>("/api/stocks", 120_000);
  useReveal();

  return (
    <>
      <SiteNav />
      <EngineHero />

      <main>
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

        <section className="block" id="proofs">
          <div className="wrap">
            <SectionHead
              overline="See it working"
              title="Don't take our word for it. Check each piece live."
              lead="Every claim on this page can be checked from your browser: generate a real zero-knowledge proof, read the live Sentora vault, open the predictions recorded on Base and the on-chain Oracle, and read the machine-checked rules."
            />
            <ProtocolShowcase snap={snap} />
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
