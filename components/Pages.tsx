"use client";

import { useEffect, useState } from "react";
import type { OracleSnapshot } from "@/lib/oracle";
import { DEPLOYMENT, NETWORK, addrUrl, isDeployed, isMainnet, sym } from "@/lib/chain";
import { ApiPanel } from "./ApiPanel";
import { Cloak, VerifyProof } from "./Cloak";
import { GuardianConsole } from "./GuardianConsole";
import { Ledger } from "./Ledger";
import { OnchainVault } from "./OnchainVault";
import { OracleBoard } from "./OracleBoard";
import { OracleChart } from "./OracleChart";
import { ShiftReport } from "./ShiftReport";
import { StackTab } from "./StackTab";
import { PageHero, PageShell, SectionHead } from "./Site";
import { useApi } from "./useApi";
import { VaultApp } from "./VaultApp";
import { Verified } from "./Verified";
import { ActivityProof } from "./Transactions";

const useSnapshot = () => useApi<OracleSnapshot>("/api/oracle", 60_000).data;

// ---------------------------------------------------------------- /app

export function AppPage() {
  const snap = useSnapshot();
  const [mode, setMode] = useState<"testnet" | "paper">(isDeployed ? "testnet" : "paper");
  // Borrow and Stack are two tabs of the same page; /app#stack opens Stack
  const [tab, setTab] = useState<"borrow" | "stack">("borrow");
  // the landing page's "Try it free" button lands here: start in the no-wallet paper account
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("try") === "paper") setMode("paper");
  }, []);
  useEffect(() => {
    const sync = () => setTab(window.location.hash === "#stack" ? "stack" : "borrow");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const pick = (t: "borrow" | "stack") => {
    setTab(t);
    window.history.replaceState(null, "", t === "stack" ? "#stack" : window.location.pathname);
    window.dispatchEvent(new HashChangeEvent("hashchange")); // replaceState is silent; tell the guide which tab is showing
  };
  return (
    <PageShell>
      <PageHero
        overline={tab === "stack" ? "APP · STACK" : "APP · BORROW"}
        title={tab === "stack" ? "Stack gold and silver, automatically." : "Borrow against ETF tokens, priced overnight."}
        lead={
          tab === "stack"
            ? "Pick a metal, an amount and how often. Stack buys on schedule, but only at a fair price, and your tokens go straight to your wallet."
            : isDeployed
            ? isMainnet
              ? `Live on ${NETWORK} with demo assets that have no value: connect a wallet (it switches to ${NETWORK} for you), get demo tokens, deposit collateral and borrow ${sym("USDG")}. You only pay a few cents of ETH gas. Health factor and borrow limit update live with the Oracle, and the Guardian protects your loan before liquidation. Unaudited demo.`
              : `Connect a wallet (it switches to ${NETWORK} for you), get free test funds, deposit collateral and borrow ${sym("USDG")}. The health factor and borrow limit update live with the Oracle, and the Guardian protects your loan before liquidation.`
            : "The on-chain vault goes live on Base shortly. Until then, try the full flow without a wallet: your paper account starts with 10 SPY, 10 QQQ, 20 GLD, 100 SLV and 200 IBIT."
        }
      />
      <section className="block app-tabs-row">
        <div className="wrap">
          <div className="seg app-tabs" role="tablist" aria-label="App sections">
            <button role="tab" aria-selected={tab === "borrow"} className={tab === "borrow" ? "on" : ""} onClick={() => pick("borrow")}>Borrow</button>
            <button role="tab" aria-selected={tab === "stack"} className={tab === "stack" ? "on" : ""} onClick={() => pick("stack")}>Stack</button>
          </div>
        </div>
      </section>
      {tab === "stack" ? (
        <section className="block" id="stack">
          <div className="wrap">
            <StackTab />
          </div>
        </section>
      ) : (
      <>
      <section className="block" id="vault">
        <div className="wrap">
          <div className="seg vault-mode" role="tablist" aria-label="Vault mode">
            <button className={mode === "testnet" ? "on" : ""} onClick={() => setMode("testnet")}>
              {isMainnet ? `With wallet (${NETWORK})` : "With wallet (testnet)"}
            </button>
            <button className={mode === "paper" ? "on" : ""} onClick={() => setMode("paper")}>
              Try without wallet
            </button>
          </div>
          {mode === "testnet" ? <OnchainVault /> : snap ? <VaultApp quotes={snap.quotes} /> : <div className="skeleton">Loading vault…</div>}
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
    </PageShell>
  );
}

// ---------------------------------------------------------------- /oracle

export function OraclePage() {
  const snap = useSnapshot();
  return (
    <PageShell>
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
        lead="A Groth16 zero-knowledge proof shows a loan is safely backed at the live Oracle price without disclosing its size or liquidation level. Proofs are generated in your browser and verified by the server, or by anyone you share them with."
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

// ---------------------------------------------------------------- /transparency

function Contracts() {
  if (!isDeployed) {
    return (
      <div className="card panel contracts-pending">
        <h3>Contracts</h3>
        <p className="muted">
          The Vault, Guardian and Oracle contracts are built and tested (15 contract tests and 37 checks against the Lean model all pass) and
          go live on Base shortly. Their addresses will be listed here.
        </p>
      </div>
    );
  }
  const rows: [string, string][] = [
    ["Vault + Guardian", DEPLOYMENT.contracts.vault],
    ["Oracle", DEPLOYMENT.contracts.oracle],
    ["ZK verifier", DEPLOYMENT.contracts.verifier],
    ...(DEPLOYMENT.contracts.cloakRegistry ? [["Cloak registry (proof + Oracle price)", DEPLOYMENT.contracts.cloakRegistry] as [string, string]] : []),
    [sym("USDG"), DEPLOYMENT.contracts.usdg],
    ...Object.entries(DEPLOYMENT.tokens ?? {}).flatMap(([s, t]) => [
      [sym(s), t.address] as [string, string],
      ...(t.feed ? [[`${sym(s)} / USD feed (Chainlink-style)`, t.feed] as [string, string]] : []),
      [`${sym(s)} Morpho oracle adapter`, t.adapter] as [string, string],
    ]),
  ];
  return (
    <div className="card panel">
      <h3>Contracts on {NETWORK}{isMainnet ? " (unaudited demo, assets have no value)" : ""}</h3>
      <table className="contracts">
        <tbody>
          {rows.map(([name, addr]) => (
            <tr key={name}>
              <td>{name}</td>
              <td className="mono">
                <a href={addrUrl(addr as `0x${string}`)} target="_blank" rel="noopener noreferrer">
                  {addr} ↗
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TransparencyPage() {
  return (
    <PageShell>
      <PageHero
        overline="TRANSPARENCY"
        title="Everything you need to check us."
        lead="Every pre-open prediction is stamped on Algorand, every safety rule is a machine-checked proof, and every contract is public. Nothing here depends on trusting Nightshift."
      />
      <section className="block" id="verified">
        <div className="wrap">
          <SectionHead
            overline="Verified · Formal proofs"
            title="Safety rules, proven by math."
            lead="Every safety rule below is written as a Lean 4 theorem about Nightshift's own code. Proofs are generated by Harmonic's Aristotle and re-checked by Lean's kernel; a rule shows as verified only once its proof passes."
          />
          <Verified />
        </div>
      </section>
      <section className="block" id="activity">
        <div className="wrap">
          <SectionHead overline="Activity · On-chain" title="Proof it's running." lead="Every flow, counted from the chains themselves: loans, repayments, Guardian rules, Oracle updates, proofs and predictions. Each tile links to its latest transaction." />
          <ActivityProof />
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
      <section className="block" id="contracts">
        <div className="wrap">
          <SectionHead overline="Contracts" title="Public, verifiable code." />
          <Contracts />
        </div>
      </section>
    </PageShell>
  );
}
