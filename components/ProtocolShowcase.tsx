"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useState } from "react";
import properties from "@/formal/properties.json";
import type { SentoraEarn } from "@/lib/earn/sentora";
import type { OracleSnapshot } from "@/lib/oracle";
import { loadSnarkjs, randomFieldSalt, type Groth16Proof } from "./Cloak";
import { usd, useApi } from "./useApi";

type Step = "idle" | "proving" | "verifying" | "done" | "cheating" | "error";
type Verdict = { valid: boolean; accepted: boolean; verifyMs: number; checks: { priceMatchesOracle: boolean; lltvMatchesMarket: boolean } };
type LedgerFeed = { configured: boolean; accountUrl?: string; entries?: { session: string; explorer: string; tokens: { errBps: number | null }[] }[] };
type ChainFeed = { deployed: boolean; chainName?: string; explorer?: string; contracts?: { oracle: string }; prices?: { token: string; price: number; confidence: number; updatedAt: number }[] };


/**
 * Homepage proof-of-work for each protocol: a one-click Groth16 proof generated in the visitor's browser and checked by
 * the server (then a forged one refused), next to live tiles for Sentora, the public record on Base, the on-chain Oracle on Base and the Lean proofs.
 */
export function ProtocolShowcase({ snap }: { snap: OracleSnapshot | null }) {
  const q = snap?.quotes.find((x) => x.token === "SPY") ?? snap?.quotes[0] ?? null;
  const [step, setStep] = useState<Step>("idle");
  const [proved, setProved] = useState<{ proof: Groth16Proof; publicSignals: string[]; ms: number; token: string } | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [forged, setForged] = useState<Verdict | null>(null);
  const [error, setError] = useState("");

  // the hidden position: 10 tokens, borrowed at 60% of the limit so it is comfortably solvent
  const units = q?.token === "IBIT" ? 100 : 10;
  const debt = q ? Math.round((units * q.fairValue * q.lltv * 0.6) / 100) * 100 : 0;

  async function check(p: NonNullable<typeof proved>, publicSignals: string[]): Promise<Verdict> {
    const res = await fetch("/api/zk/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: p.token, proof: p.proof, publicSignals }),
    });
    return res.json();
  }

  async function run() {
    if (!q) return;
    setError("");
    setVerdict(null);
    setForged(null);
    setStep("proving");
    try {
      const snarkjs = await loadSnarkjs();
      const t0 = performance.now();
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        {
          priceCents: String(Math.round(q.fairValue * 100)),
          lltvBps: String(Math.round(q.lltv * 10000)),
          units: String(units * 1e4),
          debtCents: String(debt * 100),
          salt: randomFieldSalt(),
        },
        "/zk/solvency.wasm",
        "/zk/solvency_final.zkey",
      );
      const p = { proof, publicSignals, ms: Math.round(performance.now() - t0), token: q.token };
      setProved(p);
      setStep("verifying");
      setVerdict(await check(p, publicSignals));
      setStep("done");
    } catch (e) {
      setError(String(e));
      setStep("error");
    }
  }

  // Forgery: keep the proof, claim the Oracle price was twice the real one.
  async function cheat() {
    if (!proved) return;
    setStep("cheating");
    try {
      setForged(await check(proved, [proved.publicSignals[0], String(BigInt(proved.publicSignals[1]) * 2n), proved.publicSignals[2]]));
      setStep("done");
    } catch (e) {
      setError(String(e));
      setStep("error");
    }
  }

  const busy = step === "proving" || step === "verifying" || step === "cheating";

  return (
    <div className="showcase">
      <div className="card panel zk-demo">
        <div className="zk-demo-head">
          <img src="/logos/zkproof.png" alt="" width={28} height={28} className="zk-logo" />
          <div>
            <span className="unit">Cloak · zero-knowledge proof · runs in your browser</span>
            <h3>Prove a loan is solvent without showing it.</h3>
          </div>
        </div>

        <ol className="zk-steps">
          <li className={step !== "idle" ? "on" : ""}>
            <b>1 · The secret</b>
            <span>
              A loan of <span className="redact">{units} {q?.token ?? "SPY"}</span> backing <span className="redact">{usd(debt, 0)}</span> of debt. These
              numbers never leave your device.
            </span>
          </li>
          <li className={proved ? "on" : ""}>
            <b>2 · The proof</b>
            <span>
              {proved
                ? `Generated in ${(proved.ms / 1000).toFixed(1)} s · ${JSON.stringify(proved.proof).length.toLocaleString()} bytes · public: price, LLTV, a sealed commitment.`
                : step === "proving"
                  ? "Running the Groth16 circuit (918 constraints)…"
                  : "Your browser proves: collateral × Oracle price × LLTV > debt."}
            </span>
          </li>
          <li className={verdict ? (verdict.accepted ? "on ok" : "on bad") : ""}>
            <b>3 · The check</b>
            <span>
              {verdict
                ? verdict.accepted
                  ? `Accepted by the server in ${verdict.verifyMs} ms. The math holds and the price matches the live Oracle.`
                  : `Not accepted: proof ${verdict.valid ? "valid" : "invalid"}, Oracle price ${verdict.checks.priceMatchesOracle ? "matches" : "doesn't match"}.`
                : step === "verifying"
                  ? "The server is verifying…"
                  : "The server verifies it without learning the loan."}
            </span>
          </li>
          {forged && (
            <li className={`on ${forged.accepted ? "ok" : "bad"}`}>
              <b>4 · The cheat</b>
              <span>
                {forged.accepted
                  ? "Unexpected: the forged proof was accepted."
                  : "Same proof, but claiming the price was double: refused. Change any public number and the proof breaks."}
              </span>
            </li>
          )}
        </ol>

        {error && <p className="zk-error">Proof failed: {error}</p>}
        <div className="zk-actions">
          <button className="btn primary" onClick={run} disabled={!q || busy}>
            {step === "proving" ? "Proving…" : step === "verifying" ? "Verifying…" : proved ? "Prove again" : "Generate a live proof"}
          </button>
          {proved && verdict?.accepted && (
            <button className="btn secondary" onClick={cheat} disabled={busy}>
              {step === "cheating" ? "Checking…" : "Try to cheat"}
            </button>
          )}
          <Link className="zk-more" href="/proof">
            Prove your own loan →
          </Link>
        </div>
      </div>

      <div className="showcase-tiles">
        <SentoraTile />
        <LedgerTile />
        <BaseOracleTile />
        <article className="card showcase-tile">
          <header>
            <img src="/logos/harmonic.svg" alt="" width={22} height={22} />
            <span className="unit">Harmonic · Lean 4</span>
          </header>
          <strong>{properties.length} theorems</strong>
          <p>Machine-checked proofs of the Vault, Guardian, Oracle and Cloak rules, e.g. &ldquo;{properties[0].plain}&rdquo;</p>
          <a href="https://github.com/nightshift-labs007/nightshift-formal" target="_blank" rel="noopener noreferrer">Read every theorem ↗</a>
        </article>
      </div>
    </div>
  );
}

function SentoraTile() {
  const { data } = useApi<SentoraEarn>("/api/earn/sentora", 600_000);
  const apy = data?.apyPublished?.apy ?? data?.apy7d ?? null;
  return (
    <article className="card showcase-tile">
      <header>
        <img src="/logos/sentora.png" alt="" width={22} height={22} />
        <span className="unit">Sentora · live vault</span>
      </header>
      <strong>{apy === null ? "—" : `${apy.toFixed(1)}% APY`}</strong>
      <p>
        {data ? `${data.vault.name}, ${data.vault.asset} on ${data.vault.chain}` : "Loading the vault…"}
        {data?.tvl ? ` · ${usd(data.tvl / 1e6, 2)}M deposited` : ""}
        {data?.coverActive ? " · Firelight cover" : ""}. Read-only; deposits happen on Sentora.
      </p>
      <Link href="/earn">See the live vault →</Link>
    </article>
  );
}

function LedgerTile() {
  const { data } = useApi<LedgerFeed>("/api/ledger", 600_000);
  const last = data?.entries?.[0];
  const errs = (last?.tokens ?? []).map((t) => t.errBps).filter((x): x is number => x !== null);
  return (
    <article className="card showcase-tile">
      <header>
        <img src="/logos/base.svg" alt="" width={22} height={22} />
        <span className="unit">Base · prediction record</span>
      </header>
      <strong>{last ? `Locked for ${last.session}` : "Locked before the open"}</strong>
      <p>
        {last
          ? errs.length
            ? `Graded against the real open: average miss ${Math.round(errs.reduce((a, b) => a + b, 0) / errs.length)} bps.`
            : "Waiting for the open to grade it."
          : "Every weekday, predicted opens are recorded on Base before 09:30 ET, then graded in public, misses included."}
      </p>
      {last ? (
        <a href={last.explorer} target="_blank" rel="noopener noreferrer">
          View the stamp ↗
        </a>
      ) : (
        <Link href="/etf/SPY">See every past call →</Link>
      )}
    </article>
  );
}

function BaseOracleTile() {
  const { data } = useApi<ChainFeed>("/api/chain", 60_000);
  const feeds = data?.prices ?? [];
  const newest = feeds.length ? Math.max(...feeds.map((f) => f.updatedAt)) : null;
  const mins = newest ? Math.max(0, Math.round((Date.now() / 1000 - newest) / 60)) : null;
  return (
    <article className="card showcase-tile">
      <header>
        <img src="/logos/base.svg" alt="" width={22} height={22} />
        <span className="unit">Base · on-chain Oracle</span>
      </header>
      <strong>{feeds.length ? `${feeds.length} prices on-chain` : data?.deployed ? "Oracle live" : "Oracle not deployed here"}</strong>
      <p>
        {feeds.length
          ? `Fair values and confidence written to the Oracle contract on ${data?.chainName ?? "Base"}${mins !== null ? `, last update ${mins} min ago` : ""}. A push that moves a price more than 15% is refused.`
          : "Fair values and confidence written to the Oracle contract on Base, with a 15% per-update move limit."}
      </p>
      {data?.explorer && data.contracts?.oracle ? (
        <a href={`${data.explorer}/address/${data.contracts.oracle}`} target="_blank" rel="noopener noreferrer">
          Oracle on the explorer ↗
        </a>
      ) : (
        <Link href="/oracle">See live prices →</Link>
      )}
    </article>
  );
}
