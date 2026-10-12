"use client";

import { useEffect, useState } from "react";
import type { OracleSnapshot } from "@/lib/oracle";
import { ApiPanel } from "./ApiPanel";
import { Cloak, VerifyProof } from "./Cloak";
import { CountUp } from "./CountUp";
import { GuardianConsole } from "./GuardianConsole";

import { HowItWorks } from "./HowItWorks";
import { Ledger } from "./Ledger";
import { OracleBoard } from "./OracleBoard";
import { OracleChart } from "./OracleChart";
import { ShiftReport } from "./ShiftReport";
import { Toaster } from "./Toast";
import { usd, useApi } from "./useApi";
import { VaultApp } from "./VaultApp";
import { isDeployed } from "@/lib/chain";
import { OnchainVault } from "./OnchainVault";
import { TopStocks } from "./Stocks";
import { Earn } from "./Earn";
import { Verified } from "./Verified";
import { BrandMark } from "./BrandMark";
import { AlwaysOnAudio } from "./AlwaysOnAudio";
import type { StockBoard } from "@/lib/stocks";

const NAV = [
  { id: "stocks", label: "Stocks" },
  { id: "how", label: "Product" },
  { id: "oracle", label: "Oracle" },
  { id: "vault", label: "Vault" },
  { id: "guardian", label: "Guardian" },
  { id: "cloak", label: "Cloak" },
  { id: "ledger", label: "Ledger" },
  { id: "earn", label: "Earn" },
];


function VaultModes({ snap }: { snap: OracleSnapshot | null }) {
  const [mode, setMode] = useState<"testnet" | "paper">(isDeployed ? "testnet" : "paper");
  return (
    <>
      <div className="seg vault-mode" role="tablist" aria-label="Vault mode">
        <button className={mode === "testnet" ? "on" : ""} onClick={() => setMode("testnet")}>
          On-chain testnet
        </button>
        <button className={mode === "paper" ? "on" : ""} onClick={() => setMode("paper")}>
          Paper trading
        </button>
      </div>
      {mode === "testnet" ? <OnchainVault /> : snap ? <VaultApp quotes={snap.quotes} /> : <div className="skeleton">Loading vault…</div>}
    </>
  );
}

/** The Nightshift engine scene (the Roboky Nightfall world with Engine N—01), served from /engine. */
function EngineHero() {
  return (
    <section className="engine-hero" id="top" aria-label="Nightshift engine, interactive">
      <iframe src="/engine/index.html" title="Nightshift Engine N—01: interactive live engine" allow="autoplay" />
    </section>
  );
}

function SectionHead({ overline, title, lead, aside }: { overline: string; title: string; lead?: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <header className="section-head">
      <div>
        <p className="overline">{overline}</p>
        <h2>{title}</h2>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {aside && <div className="section-aside">{aside}</div>}
    </header>
  );
}

function MarketStrip({ snap }: { snap: OracleSnapshot | null }) {
  return (
    <div className="market-strip" aria-label="Live Oracle prices">
      <div className="wrap strip-inner">
        {(snap?.quotes ?? []).map((q) => (
          <a key={q.token} className="strip-item" href="#oracle">
            <span className="strip-token">{q.token}</span>
            <span className="strip-price">
              <CountUp value={q.fairValue} format={(x) => usd(x)} />
            </span>
            <span className={`strip-move ${q.driftPct >= 0 ? "up" : "down"}`}>
              {q.driftPct >= 0 ? "+" : "−"}
              {Math.abs(q.driftPct).toFixed(2)}%
            </span>
            <span className="strip-conf">Conf. {q.confidence}</span>
          </a>
        ))}
        <span className="strip-meta">
          {snap ? `${snap.market.open ? "NYSE open" : "NYSE closed"} · ${snap.market.etTime}` : "Loading prices…"}
        </span>
      </div>
    </div>
  );
}

const ROADMAP = [
  { phase: "Live", title: "Oracle and shift reports", body: "Off-hours fair values for SPY, QQQ, gold and Bitcoin ETF tokens, a public API, and a graded track record." },
  { phase: isDeployed ? "Live on testnet" : "Testnet-ready", title: "Vault on Morpho", body: "Smart contracts with Morpho Blue's rules and a Morpho-compatible oracle adapter, on Base Sepolia. Next: markets on Morpho itself." },
  { phase: isDeployed ? "Live on testnet" : "Testnet-ready", title: "Guardian", body: "Borrowers opt in on-chain; a keeper protects loans around the clock. Next: alerts by email and Telegram." },
  { phase: "Live proofs", title: "Cloak", body: "Solvency proofs verified by the server and by a smart contract. Next: shielded positions and an auditor view key." },
];

/** Gentle fade-in for sections, and nav tracking of the section on screen. */
function useScrollEffects(setActive: (id: string) => void) {
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
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
    if (!reduced) {
      document.querySelectorAll("section.block").forEach((el) => {
        el.classList.add("reveal");
        reveal.observe(el);
      });
    }
    const spy = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && setActive(e.target.id)), {
      rootMargin: "-45% 0px -50% 0px",
    });
    NAV.forEach((n) => {
      const el = document.getElementById(n.id);
      if (el) spy.observe(el);
    });
    return () => {
      reveal.disconnect();
      spy.disconnect();
    };
  }, [setActive]);
}

export function Dashboard() {
  const { data: snap } = useApi<OracleSnapshot>("/api/oracle", 60_000);
  const { data: board } = useApi<StockBoard>("/api/stocks", 120_000);
  const [active, setActive] = useState("");
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useScrollEffects(setActive);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <>
      <nav className={`nav ${menu ? "open" : ""} ${scrolled ? "scrolled" : ""}`} aria-label="Main">
        <div className="wrap nav-inner">
          <a className="brand" href="#top" onClick={() => setMenu(false)}>
            <BrandMark /> Nightshift
          </a>
          <div className="nav-links" id="nav-links">
            {NAV.map((n) => (
              <a key={n.id} href={`#${n.id}`} className={active === n.id ? "active" : ""} aria-current={active === n.id ? "true" : undefined} onClick={() => setMenu(false)}>
                {n.label}
              </a>
            ))}
          </div>
          <a className="btn primary small nav-cta" href="#vault">
            Open paper vault
          </a>
          <button className="menu-btn" aria-expanded={menu} aria-controls="nav-links" onClick={() => setMenu(!menu)}>
            <span />
            <span />
            <span className="sr-only">Menu</span>
          </button>
        </div>
      </nav>

      <AlwaysOnAudio />
      <EngineHero />
      <MarketStrip snap={snap} />

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

        <section className="block alt" id="oracle">
          <div className="wrap">
            <SectionHead
              overline="Oracle · Live"
              title="Fair value while the market is closed."
              lead="Four signal models (overnight futures or Bitcoin, Asian and European markets, short-term momentum, and sentiment) are blended into one fair value per token, with a confidence score that falls the longer markets are closed."
            />
            <OracleBoard snap={snap} />
            {snap && (
              <div className="oracle-tools">
                <OracleChart quotes={snap.quotes} />
                <ApiPanel />
              </div>
            )}
            <div id="report" className="subsection">
              <h3 className="sub-title">Shift report</h3>
              <p className="lead">
                Each morning the Oracle&apos;s predicted open is graded against the actual open, alongside the frozen close a traditional
                feed would have reported.
              </p>
              <ShiftReport />
            </div>
          </div>
        </section>

        <section className="block" id="vault">
          <div className="wrap">
            <SectionHead
              overline="Vault · Paper trading"
              title="Borrow against ETF tokens, priced overnight."
              lead="Your paper wallet starts with 10 SPY, 10 QQQ, 20 GLD and 200 IBIT. Deposit, borrow USDG, repay or close. Every position is marked to the live Oracle and follows Morpho Blue's lending and liquidation rules."
            />
            <VaultModes snap={snap} />
          </div>
        </section>

        <section className="block alt" id="guardian">
          <div className="wrap">
            <SectionHead
              overline="Guardian · Paper trading"
              title="Loan monitoring that acts before liquidation."
              lead="Set a trigger health factor on each loan. When the Oracle moves a loan below it, the Guardian alerts you or repays automatically by selling just enough collateral."
            />
            {snap ? <GuardianConsole snap={snap} /> : <div className="skeleton">Loading guardian…</div>}
          </div>
        </section>

        <section className="block" id="cloak">
          <div className="wrap">
            <SectionHead
              overline="Cloak · Zero-knowledge proofs"
              title="Prove a loan is solvent without revealing it."
              lead="A Groth16 proof shows a loan is safely backed at the live Oracle price without disclosing its size or liquidation level. Proofs are generated in your browser and verified by the server."
            />
            {snap ? <Cloak quotes={snap.quotes} /> : <div className="skeleton">Loading prover…</div>}
            <VerifyProof />
          </div>
        </section>

        <section className="block alt" id="verified">
          <div className="wrap">
            <SectionHead
              overline="Verified · Formal proofs"
              title="Safety rules, proven by math."
              lead="Every safety rule below is written as a Lean 4 theorem about Nightshift's own code. Proofs are generated by Harmonic's Aristotle and re-checked by Lean's kernel on every code change; a rule shows as verified only once its proof passes."
            />
            <Verified />
          </div>
        </section>

        <section className="block alt" id="ledger">
          <div className="wrap">
            <SectionHead
              overline="Ledger · Algorand"
              title="Every prediction, on the record."
              lead="Before each opening bell, the Oracle's predictions are written to Algorand, so the track record can't be edited afterwards."
            />
            <Ledger />
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
              <p>Open a paper position and watch it priced, monitored and proven through the night.</p>
            </div>
            <div className="cta-actions">
              <a className="btn primary" href="#vault">
                Open paper vault
              </a>
              <a className="btn secondary" href="#oracle">
                View live prices
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-inner">
          <a className="brand" href="#top">
            <BrandMark /> Nightshift
          </a>
          <p>
            Concept demonstration. Oracle values are data, not investment advice. The Vault and Guardian run in paper-trading mode in
            your browser; no funds are handled. Stock Tokens are not available to US persons. Market data comes from public feeds and
            may be delayed or simulated where marked. The Earn panel shows a third-party vault run by Sentora; deposits happen on Sentora's site, and Nightshift does not hold funds or control that vault.
          </p>
        </div>
      </footer>
      <Toaster />
    </>
  );
}
