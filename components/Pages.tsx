"use client";

import { useState } from "react";
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
import { PageHero, PageShell, SectionHead } from "./Site";
import { useApi } from "./useApi";
import { VaultApp } from "./VaultApp";
import { Verified } from "./Verified";

const useSnapshot = () => useApi<OracleSnapshot>("/api/oracle", 60_000).data;

// ---------------------------------------------------------------- /app

export function AppPage() {
  const snap = useSnapshot();
  const [mode, setMode] = useState<"testnet" | "paper">(isDeployed ? "testnet" : "paper");
  return (
    <PageShell>
      <PageHero
        overline="APP · BORROW"
        title="Borrow against ETF tokens, priced overnight."
        lead={
          isDeployed
            ? isMainnet
              ? `Live on ${NETWORK} with demo assets that have no value: connect a wallet (it switches to ${NETWORK} for you), get demo tokens, deposit collateral and borrow ${sym("USDG")}. You only pay a few cents of ETH gas. Health factor and borrow limit update live with the Oracle, and the Guardian protects your loan before liquidation. Unaudited demo.`
              : `Connect a wallet (it switches to ${NETWORK} for you), get free test funds, deposit collateral and borrow ${sym("USDG")}. The health factor and borrow limit update live with the Oracle, and the Guardian protects your loan before liquidation.`
            : "The on-chain vault goes live on Base shortly. Until then, try the full flow without a wallet: your paper account starts with 10 SPY, 10 QQQ, 20 GLD and 200 IBIT."
        }
      />
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
            lead="Set a trigger health factor on each loan. When the Oracle moves a loan below it, the Guardian alerts you or repays automatically by selling just enough collateral. If selling can't help, it only alerts."
          />
          {snap ? <GuardianConsole snap={snap} /> : <div className="skeleton">Loading guardian…</div>}
        </div>
      </section>
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
    [sym("USDG"), DEPLOYMENT.contracts.usdg],
    ...Object.entries(DEPLOYMENT.tokens ?? {}).map(([s, t]) => [sym(s), (t as { address: string }).address] as [string, string]),
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
