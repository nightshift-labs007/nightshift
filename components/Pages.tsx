"use client";

import { useEffect, useRef, useState } from "react";
import type { OracleSnapshot } from "@/lib/oracle";
import { DEPLOYMENT, NETWORK, PREDICT_STAKE, addrUrl, isDeployed, isMainnet, sym } from "@/lib/chain";
import { ApiPanel } from "./ApiPanel";
import { Cloak, VerifyProof } from "./Cloak";
import { GuardianConsole } from "./GuardianConsole";
import { OnchainVault } from "./OnchainVault";
import { OracleBoard } from "./OracleBoard";
import { OracleChart } from "./OracleChart";
import { ShiftReport } from "./ShiftReport";
import { StackTab } from "./StackTab";
import { MemberGate } from "./Member";
import { PageHero, PageShell, SectionHead } from "./Site";
import { SignedInGate } from "./SignedIn";
import { useApi } from "./useApi";
import { VaultApp } from "./VaultApp";
import { GettingStarted } from "./GettingStarted";
import { FairPrices } from "./FairPrices";
import { PredictTab } from "./PredictTab";
import { TopStocks } from "./Stocks";
import type { StockBoard } from "@/lib/stocks";
import { MarketNotice } from "./Markets";
import { appTab, type AppTab } from "@/lib/app-tabs";
import { markStep } from "@/lib/onboarding";
import { useAccount } from "@/lib/paper";
import { useWallet } from "@/lib/wallet";


const INTRO: Record<AppTab, string> = {
  prices: "Real prices while Wall Street is open. Nightshift fair value while it's closed.",
  borrow: isDeployed
    ? `Borrow ${sym("USDG")} against ETF tokens. Practice without a wallet, or connect one and get free demo funds.`
    : "Borrow against ETF tokens with a practice account. No wallet needed.",
  stack: "Buy gold and silver on a schedule, only at a fair price.",
  predict: PREDICT_STAKE.real
    ? `Predict whether each ETF opens higher or lower than Nightshift's call, with small ${PREDICT_STAKE.symbol} stakes. Beta.`
    : "Predict whether each ETF opens higher or lower than Nightshift's call. Demo tokens, no value.",
};

const useSnapshot = () => useApi<OracleSnapshot>("/api/oracle", 60_000).data;

// ---------------------------------------------------------------- /app

export function AppPage() {
  const snap = useSnapshot();
  const { data: board } = useApi<StockBoard>("/api/stocks", 120_000);
  // practice first: visitors without a wallet start in the paper account; a connected wallet switches to the real
  // demo, unless the visitor picked a mode themselves
  const [mode, setModeState] = useState<"testnet" | "paper">("paper");
  const picked = useRef(false);
  const setMode = (m: "testnet" | "paper") => {
    picked.current = true;
    setModeState(m);
  };
  const wallet = useWallet();
  const paper = useAccount();
  useEffect(() => {
    if (wallet.account && isDeployed && !picked.current) setModeState("testnet");
  }, [wallet.account]);
  // Prices, Borrow and Stack are tabs of the same page: /app opens Prices, /app#vault (or #guardian) Borrow, /app#stack Stack
  const [tab, setTab] = useState<AppTab>("prices");
  // the landing page's "Try it free" button lands here: start in the no-wallet paper account
  useEffect(() => {
    const read = () => {
      const q = new URLSearchParams(window.location.search);
      if (q.get("try") === "paper") setMode("paper");
      const loan = q.get("loan"); // Nyx: "show me my loan"
      if (loan === "wallet" || loan === "paper") setMode(loan === "wallet" ? "testnet" : "paper");
    };
    read();
    window.addEventListener("hashchange", read); // Nyx and the menu link here while the page is already open
    return () => window.removeEventListener("hashchange", read);
  }, []);
  useEffect(() => {
    const sync = () => {
      const q = new URLSearchParams(window.location.search);
      setTab(appTab(window.location.hash, q.has("try") || q.has("loan")));
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const pick = (t: AppTab) => {
    setTab(t);
    window.history.replaceState(null, "", t === "stack" ? "#stack" : t === "predict" ? "#predict" : t === "borrow" ? "#vault" : window.location.pathname);
    window.dispatchEvent(new HashChangeEvent("hashchange")); // replaceState is silent; tell the guide which tab is showing
  };
  const hero = INTRO[tab];
  useEffect(() => {
    if (tab === "prices") markStep("price");
  }, [tab]);
  return (
    <PageShell>
      <SignedInGate>
      <section className="block app-top">
        <div className="wrap">
          <div className="app-top-row">
            <div className="seg app-tabs" role="tablist" aria-label="App sections">
              <button role="tab" aria-selected={tab === "prices"} className={tab === "prices" ? "on" : ""} onClick={() => pick("prices")}>Prices</button>
              <button role="tab" aria-selected={tab === "borrow"} className={tab === "borrow" ? "on" : ""} onClick={() => pick("borrow")}>Borrow</button>
              <button role="tab" aria-selected={tab === "stack"} className={tab === "stack" ? "on" : ""} onClick={() => pick("stack")}>Stack</button>
              <button role="tab" aria-selected={tab === "predict"} className={tab === "predict" ? "on" : ""} onClick={() => pick("predict")}>Predict</button>
            </div>
            <p className="app-intro">{hero}</p>
          </div>
          {tab === "borrow" && <MarketNotice />}
        </div>
      </section>
      {tab === "prices" ? (
        <>
        <section className="block" id="prices">
          <div className="wrap">
            <FairPrices snap={snap} />
          </div>
        </section>
        <section className="block" id="stocks">
          <div className="wrap">
            <SectionHead
              overline="Big stocks"
              title="The world's biggest stocks, priced after the bell."
              lead="The same engine estimates where each of these would trade right now, from index futures and each stock's measured sensitivity to them."
            />
            <TopStocks board={board} />
          </div>
        </section>
        </>
      ) : tab === "predict" ? (
        <section className="block" id="predict">
          <div className="wrap">
            <PredictTab />
          </div>
        </section>
      ) : tab === "stack" ? (
        <section className="block" id="stack">
          <div className="wrap">
            <MemberGate what="Stack">
              <StackTab />
            </MemberGate>
          </div>
        </section>
      ) : (
      <>
      <section className="block" id="vault">
        <div className="wrap">
          <div className="seg vault-mode" role="tablist" aria-label="Vault mode">
            <button className={mode === "paper" ? "on" : ""} onClick={() => setMode("paper")}>
              Practice (no wallet)
            </button>
            {isDeployed && (
              <button className={mode === "testnet" ? "on" : ""} onClick={() => setMode("testnet")}>
                {isMainnet ? `With wallet (${NETWORK})` : "With wallet (testnet)"}
              </button>
            )}
          </div>
          {mode === "paper" && isDeployed && (
            <p className="small muted mode-note">
              {paper.positions.length
                ? <>Ready for the real thing? <button className="link-btn" onClick={() => setMode("testnet")}>Switch to With wallet</button> to make real demo transactions on {NETWORK}. Demo tokens are free; you only need a few cents of gas.</>
                : "Practice account: it lives in this browser, is already funded, and needs no wallet. Open a loan below to try it."}
            </p>
          )}
          {mode === "testnet" ? <MemberGate what="Borrow with your wallet" practice={() => setMode("paper")}><OnchainVault /></MemberGate> : snap ? <VaultApp quotes={snap.quotes} /> : <div className="skeleton">Loading vault…</div>}
        </div>
      </section>
      <section className="block alt" id="guardian">
        <div className="wrap">
          <SectionHead
            overline="Guardian"
            title="Loan monitoring that acts before liquidation."
            lead="Set a trigger health factor on each loan. When the Oracle moves a loan below it, the Guardian alerts you in the app, or rebalances it automatically: it uses just enough collateral to repay debt and lift the loan back to your target. If that can't help, it only alerts."
          />
          {snap ? <GuardianConsole snap={snap} /> : <div className="skeleton">Loading guardian…</div>}
          <p className="small muted" style={{ marginTop: 14, maxWidth: 820 }}>
            <b>How a rebalance works in this demo:</b> the Vault itself takes the collateral at the Oracle price minus 0.5% and cancels the same
            value of debt. Nothing is traded on a DEX. A production version would sell the collateral through a DEX, with real slippage.
            Alerts appear in the app and, if you allow them, as browser notifications while the page is open; email and Telegram alerts are next.
          </p>
        </div>
      </section>
      </>
      )}
      <section className="block app-start">
        <div className="wrap">
          <GettingStarted />
        </div>
      </section>
      </SignedInGate>
    </PageShell>
  );
}

// ---------------------------------------------------------------- /oracle

export function OraclePage() {
  const snap = useSnapshot();
  useEffect(() => markStep("price"), []);
  return (
    <PageShell>
      <SignedInGate>
      <PageHero
        overline="ORACLE · LIVE"
        title="Fair value while the market is closed."
        lead="Four signal models (overnight futures or Bitcoin, Asian and European markets, short-term momentum and sentiment) are blended into one fair value per token, with a confidence score that falls the longer markets are closed."
      />
      <section className="block" id="oracle">
        <div className="wrap">
          <OracleBoard snap={snap} />
          {snap && (
            <div className="oracle-tools">
              <OracleChart quotes={snap.quotes} />
              <ApiPanel />
            </div>
          )}
          <div id="report" className="subsection">
            <h3 className="sub-title">Shift report</h3>
            <p className="lead">Each morning the Oracle&apos;s predicted open is graded against the actual open, alongside the frozen close a traditional feed would have reported.</p>
            <ShiftReport />
          </div>
        </div>
      </section>
      </SignedInGate>
    </PageShell>
  );
}

// ---------------------------------------------------------------- /proof

export function ProofPage() {
  const snap = useSnapshot();
  return (
    <PageShell>
      <PageHero
        overline="PROOF · CLOAK"
        title="Prove a loan is solvent without revealing it."
        lead="A Groth16 zero-knowledge proof shows a loan is fully backed (health factor above 1) at the live Oracle price without disclosing its size or liquidation level. Proofs are generated in your browser and verified by the server, or by anyone you share them with."
      />
      <section className="block" id="cloak">
        <div className="wrap">
          {snap ? <Cloak quotes={snap.quotes} /> : <div className="skeleton">Loading prover…</div>}
          <VerifyProof />
        </div>
      </section>
    </PageShell>
  );
}

