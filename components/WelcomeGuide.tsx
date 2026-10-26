"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { NETWORK, isDeployed, isMainnet, sym } from "@/lib/chain";

type Step = { kicker: string; title: string; body: React.ReactNode; cta?: { href: string; label: string } };

const HOME: Step[] = [
  {
    kicker: "Welcome",
    title: "Stock markets close at 4pm. Tokenized ETFs don't.",
    body: (
      <>
        <p>
          Tokens like SPY, QQQ, gold and bitcoin ETFs trade around the clock on-chain, but their prices freeze when Wall Street closes.
          Nightshift keeps pricing them overnight, so you can lend and borrow against them safely while the market sleeps.
        </p>
        <p className="guide-note">This is a demo: the tokens have no value and nothing costs money except a few cents of gas.</p>
      </>
    ),
  },
  {
    kicker: "Step 1 · Prices",
    title: "Read the live fair value",
    body: (
      <>
        <p>
          The price cards on this page are Nightshift&apos;s estimate of what each ETF is worth <i>right now</i>, even with the NYSE closed.
        </p>
        <ul className="guide-list">
          <li><b>Fair value</b>: the overnight price, from futures, world markets and sentiment.</li>
          <li><b>% move</b>: the change since the last close.</li>
          <li><b>CONF</b>: how sure the engine is, from 35 to 98. It drops the longer markets stay shut.</li>
        </ul>
      </>
    ),
    cta: { href: "/oracle", label: "Open the Oracle" },
  },
  {
    kicker: "Step 2 · Borrow",
    title: "Try borrowing, with or without a wallet",
    body: (
      <>
        <p>Open the <b>App</b> and pick one:</p>
        <ul className="guide-list">
          <li><b>Try without wallet</b>: a paper account in your browser with 10 SPY, 10 QQQ, 20 GLD, 100 SLV and 200 IBIT. Nothing to install.</li>
          {isDeployed && (
            <li>
              <b>With wallet ({NETWORK})</b>: connect, click <b>Get demo tokens</b>, deposit them as collateral and borrow {sym("USDG")}.
              {isMainnet ? " You only need a few cents of ETH for gas." : ""}
            </li>
          )}
        </ul>
      </>
    ),
    cta: { href: "/app", label: "Open the App" },
  },
  {
    kicker: "Step 3 · Protect",
    title: "Switch on the Guardian",
    body: (
      <p>
        Pick a trigger health factor, for example 1.10, and a target, for example 1.40. If the overnight price pushes your loan below the
        trigger, the Guardian alerts you or uses just enough collateral to lift the loan back to the target. That happens before liquidation.
      </p>
    ),
    cta: { href: "/app#guardian", label: "See the Guardian" },
  },
  {
    kicker: "Step 4 · Verify",
    title: "Don't trust it. Check it.",
    body: (
      <ul className="guide-list">
        <li><b>Proof</b>: 24 rules machine-proven in Lean 4 with Harmonic&apos;s Aristotle, and zero-knowledge solvency proofs.</li>
        <li><b>Transparency</b>: every pre-open prediction locked on Algorand before the bell, graded after.</li>
        <li><b>Docs</b>: straight answers on how everything works, including what&apos;s still a demo.</li>
      </ul>
    ),
    cta: { href: "/proof", label: "See the proofs" },
  },
];

const APP: Step[] = [
  {
    kicker: "Using the App",
    title: "Borrow in four moves",
    body: (
      <ol className="guide-list numbered">
        <li><b>Choose a mode</b> at the top: <i>Try without wallet</i> (paper, instant) or <i>With wallet</i>{isDeployed ? ` (${NETWORK} demo)` : ""}.</li>
        <li><b>Get collateral</b>: the paper account starts funded{isDeployed ? <>; with a wallet, click <b>Get demo tokens</b></> : ""}.</li>
        <li><b>Deposit and borrow</b>: pick a token and an amount, and keep the health factor comfortably above 1.</li>
        <li><b>Set a Guardian rule</b> below, so the loan is protected while you sleep.</li>
      </ol>
    ),
  },
  {
    kicker: "Reading your loan",
    title: "Health factor, in one line",
    body: (
      <>
        <p>
          <b>Health factor = what your collateral can support ÷ what you owe.</b> Above 1 is safe. Below 1, anyone can liquidate part of the
          loan. Your borrow limit also shrinks when the Oracle&apos;s confidence is low, for example over a long weekend.
        </p>
        <p className="guide-note">Demo assets only, unaudited contracts. Never send real tokens to the Vault.</p>
      </>
    ),
  },
];

/** The App's Stack tab (/app#stack) has its own short guide. */
const STACK: Step[] = [
  {
    kicker: "Using Stack",
    title: "Automatic buying in three moves",
    body: (
      <ol className="guide-list numbered">
        <li><b>Choose</b>: gold, silver or both, how much each time, and how often. Weekly is the default.</li>
        <li><b>Approve once</b>: connect your wallet, then allow Stack to spend up to your total. It can never take more than that.</li>
        <li><b>Relax</b>: Stack buys on schedule, and the tokens go straight to your wallet. Pause or cancel any time.</li>
      </ol>
    ),
  },
  {
    kicker: "Fair price",
    title: "What “only at a fair price” means",
    body: (
      <>
        <p>
          Nightshift always knows what gold and silver are worth right now, even when markets are closed. Before every buy, Stack checks that the
          price you would pay is no more than a small margin above that fair value. If it is higher, or the price data is old or unsure, the buy waits.
        </p>
        <p className="guide-note">If a buy can&apos;t happen in time it is skipped and your money stays in your wallet. Demo assets only, unaudited.</p>
      </>
    ),
  },
];

const KEY = (p: string) => `ns-guide-seen:${p}`;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return "1"; } };
const write = (k: string) => { try { localStorage.setItem(k, "1"); } catch { /* storage blocked: the guide just won't remember */ } };

/** First-visit walkthrough on the landing page and the App, and a "Guide" button on every page to reopen it. */
export function WelcomeGuide() {
  const path = usePathname();
  // the App page has two tabs (Borrow, Stack), told apart by the URL hash
  const [hash, setHash] = useState("");
  useEffect(() => {
    const sync = () => setHash(window.location.hash);
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const stackTab = path === "/app" && hash === "#stack";
  const steps = path === "/app" ? (stackTab ? STACK : APP) : HOME;
  const guideKey = stackTab ? "/app#stack" : path;
  const auto = path === "/" || path === "/app";
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const show = useCallback(() => {
    opener.current = document.activeElement as HTMLElement | null;
    setI(0);
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    write(KEY(guideKey));
    setOpen(false);
    opener.current?.focus?.();
  }, [guideKey]);

  // Nyx (the voice assistant) can open the guide
  useEffect(() => {
    window.addEventListener("ns:guide-open", show);
    return () => window.removeEventListener("ns:guide-open", show);
  }, [show]);

  // first visit only: opening a page shows its guide once; switching tabs later doesn't pop it up again
  useEffect(() => {
    if (!auto) return;
    const key = path === "/app" && window.location.hash === "#stack" ? "/app#stack" : path;
    if (read(KEY(key))) return;
    const t = setTimeout(show, 900); // let the page settle first
    return () => clearTimeout(t);
  }, [auto, path, show]);

  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, steps.length - 1));
      else if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0));
      else if (e.key === "Tab" && box.current) {
        // keep focus inside the dialog
        const f = box.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, close, steps.length]);

  const s = steps[i];
  const last = i === steps.length - 1;
  return (
    <>
      <button className="guide-fab" onClick={show} aria-haspopup="dialog" title="How to use Nightshift">
        <span aria-hidden="true">?</span> Guide
      </button>
      {open && (
        <div className="guide-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className="guide" role="dialog" aria-modal="true" aria-labelledby="guide-title" ref={box}>
            <button className="guide-x" onClick={close} aria-label="Close guide">×</button>
            <p className="guide-kicker">{s.kicker}</p>
            <h2 id="guide-title">{s.title}</h2>
            <div className="guide-body">{s.body}</div>
            {s.cta && (
              <Link className="guide-cta" href={s.cta.href} onClick={close}>
                {s.cta.label} →
              </Link>
            )}
            <div className="guide-foot">
              <div className="guide-dots" aria-label={`Step ${i + 1} of ${steps.length}`}>
                {steps.map((_, k) => (
                  <button key={k} className={k === i ? "on" : ""} onClick={() => setI(k)} aria-label={`Go to step ${k + 1}`} aria-current={k === i ? "step" : undefined} />
                ))}
              </div>
              <div className="guide-nav">
                {i > 0 ? (
                  <button className="btn secondary small" onClick={() => setI(i - 1)}>Back</button>
                ) : (
                  <button className="btn secondary small" onClick={close}>Skip</button>
                )}
                {last ? (
                  <button className="btn primary small" onClick={close} data-autofocus>Start exploring</button>
                ) : (
                  <button className="btn primary small" onClick={() => setI(i + 1)} data-autofocus>{i === 0 && steps === HOME ? "Show me around" : "Next"}</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
