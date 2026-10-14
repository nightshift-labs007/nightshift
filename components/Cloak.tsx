"use client";

import { useEffect, useState } from "react";
import type { Quote } from "@/lib/oracle";
import { useAccount } from "@/lib/paper";
import { DEPLOYMENT, isDeployed } from "@/lib/chain";
import { verifyOnChain } from "@/lib/chain/verify";
import { toast } from "./Toast";
import { usd } from "./useApi";

// snarkjs (~700 KB) is loaded from /zk only when the user asks for a proof.
type Snarkjs = {
  groth16: {
    fullProve: (input: Record<string, string>, wasm: string, zkey: string) => Promise<{ proof: Groth16Proof; publicSignals: string[] }>;
  };
};
type Groth16Proof = { pi_a: string[]; pi_b: string[][]; pi_c: string[]; protocol: string; curve: string };

let snarkjsPromise: Promise<Snarkjs> | null = null;
function loadSnarkjs(): Promise<Snarkjs> {
  const w = window as unknown as { snarkjs?: Snarkjs };
  if (w.snarkjs) return Promise.resolve(w.snarkjs);
  snarkjsPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/zk/snarkjs.min.js";
    s.onload = () => (w.snarkjs ? resolve(w.snarkjs) : reject(new Error("snarkjs failed to load")));
    s.onerror = () => reject(new Error("snarkjs failed to load"));
    document.head.appendChild(s);
  });
  return snarkjsPromise;
}

function randomFieldSalt() {
  const b = new Uint8Array(31); // < BN254 field size
  crypto.getRandomValues(b);
  return BigInt("0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")).toString();
}

type Proved = { proof: Groth16Proof; publicSignals: string[]; proveMs: number; token: string };
type Verdict = {
  valid: boolean;
  accepted: boolean;
  verifyMs: number;
  tampered: boolean;
  checks: { proof: boolean; priceMatchesOracle: boolean; lltvMatchesMarket: boolean; oracleCents: number | null };
};

export function Cloak({ quotes }: { quotes: Quote[] }) {
  const account = useAccount();
  const [i, setI] = useState(0);
  const [source, setSource] = useState("manual"); // "manual" or a Vault position id
  const pos = account.positions.find((p) => p.id === source && p.status === "open");
  const q = pos ? quotes.find((x) => x.token === pos.token) ?? quotes[i] : quotes[i];
  const [manualUnits, setUnits] = useState(10);
  const [manualDebt, setDebt] = useState(3000);
  const units = pos ? Math.floor(pos.units * 1e4) / 1e4 : manualUnits; // round down: never overstate collateral
  const debt = pos ? Math.ceil(pos.debt * 100 - 1e-9) / 100 : manualDebt; // round up: never understate debt (formal C4)
  const [salt, setSalt] = useState("");
  const [busy, setBusy] = useState<"" | "prove" | "verify">("");
  const [proved, setProved] = useState<Proved | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState("");
  const [onchain, setOnchain] = useState<"" | "checking" | "valid" | "math-only" | "invalid">("");

  useEffect(() => setSalt(randomFieldSalt()), []);
  // "Prove with Cloak" from a Vault position card
  useEffect(() => {
    try {
      const pick = sessionStorage.getItem("ns.cloak.pick");
      if (pick) {
        sessionStorage.removeItem("ns.cloak.pick");
        setSource(pick);
      }
    } catch {
      /* storage unavailable */
    }
    const on = (e: Event) => setSource((e as CustomEvent<string>).detail);
    window.addEventListener("nightshift:cloak", on);
    return () => window.removeEventListener("nightshift:cloak", on);
  }, []);
  useEffect(() => {
    if (pos) return;
    setUnits(q.token === "IBIT" ? 100 : 10);
    setDebt(Math.round(((q.token === "IBIT" ? 100 : 10) * q.fairValue * q.lltv * 0.6) / 100) * 100);
  }, [q.token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Any change to the position invalidates an existing proof.
  useEffect(() => {
    setProved(null);
    setVerdict(null);
    setError("");
    setOnchain("");
  }, [units, debt, i, source]);

  const priceCents = Math.round(q.fairValue * 100);
  const lltvBps = Math.round(q.lltv * 10000);
  const liqPrice = debt / (units * q.lltv);
  const hfAtFair = (units * q.fairValue * q.lltv) / Math.max(debt, 1e-9);

  async function prove() {
    setBusy("prove");
    setError("");
    setVerdict(null);
    setOnchain("");
    try {
      const snarkjs = await loadSnarkjs();
      const t0 = performance.now();
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        {
          priceCents: String(priceCents),
          lltvBps: String(lltvBps),
          units: String(Math.floor(units * 1e4 + 1e-9)), // collateral rounds down (formal C4)
          debtCents: String(Math.ceil(debt * 100 - 1e-9)), // debt rounds up (formal C4)
          salt,
        },
        "/zk/solvency.wasm",
        "/zk/solvency_final.zkey",
      );
      const p: Proved = { proof, publicSignals, proveMs: Math.round(performance.now() - t0), token: q.token };
      setProved(p);
      await verify(p, false);
    } catch (e) {
      const msg = String(e);
      setError(
        /assert/i.test(msg)
          ? "No proof possible: this position is under-collateralized at the Oracle price. The circuit refuses to lie."
          : `Proof generation failed: ${msg}`,
      );
    } finally {
      setBusy("");
    }
  }

  async function verify(p: Proved, tamper: boolean) {
    setBusy("verify");
    // Tampering: claim the Oracle price was double what it really is.
    const publicSignals = tamper ? [p.publicSignals[0], String(BigInt(p.publicSignals[1]) * 2n), p.publicSignals[2]] : p.publicSignals;
    try {
      const res = await fetch("/api/zk/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: p.token, proof: p.proof, publicSignals }),
      });
      const json = await res.json();
      setVerdict({ ...json, tampered: tamper });
    } catch (e) {
      setError(`Verifier unreachable: ${String(e)}`);
    } finally {
      setBusy("");
    }
  }

  const commitment = proved?.publicSignals[0];
  const proofBytes = proved ? JSON.stringify(proved.proof).length : 0;

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="cloak-source">
        <label className="field" htmlFor="cloak-source" style={{ margin: 0 }}>
          Position to prove
        </label>
        <select id="cloak-source" value={pos ? source : "manual"} onChange={(e) => setSource(e.target.value)}>
          <option value="manual">Example position (edit the numbers)</option>
          {account.positions
            .filter((p) => p.status === "open")
            .map((p) => (
              <option key={p.id} value={p.id}>
                My Vault position {p.id}: {p.units.toFixed(4).replace(/\.?0+$/, "")} {p.token}, {usd(p.debt, 0)} debt
              </option>
            ))}
        </select>
        {!pos && (
          <div className="tabs" style={{ margin: 0 }}>
            {quotes.map((x, j) => (
              <button key={x.token} className={`tab ${j === i ? "on" : ""}`} onClick={() => setI(j)}>
                {x.token}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid cols-2">
        <div className="panel red">
          <div className="unit">On a public chain today</div>
          <table style={{ marginTop: 8 }}>
            <tbody>
              <tr><td className="muted">Borrower</td><td className="num">0x7a3f…c91e</td></tr>
              <tr><td className="muted">Collateral</td><td className="num">{units} {q.token}</td></tr>
              <tr><td className="muted">Debt</td><td className="num">{usd(debt, 0)} USDG</td></tr>
              <tr><td className="muted">Liquidation price</td><td className="num down">{usd(liqPrice)}</td></tr>
            </tbody>
          </table>
          <p className="small muted">
            A bot only needs to push thin weekend liquidity to {usd(liqPrice)} to collect the liquidation bonus.
          </p>
          <div className="grid cols-2" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label className="field">Units</label>
              <input type="number" min={0.0001} step="any" value={units} readOnly={!!pos} onChange={(e) => setUnits(Math.max(0.0001, Number(e.target.value) || 0.0001))} />
            </div>
            <div>
              <label className="field">Debt (USDG)</label>
              <input type="number" min={1} value={debt} readOnly={!!pos} onChange={(e) => setDebt(Math.max(1, Number(e.target.value) || 1))} />
            </div>
          </div>
          <p className="xs mono muted" style={{ marginBottom: 0 }}>
            HF at Oracle fair value {usd(q.fairValue)}: <span className={hfAtFair > 1 ? "up" : "down"}>{hfAtFair.toFixed(2)}</span>
          </p>
        </div>

        <div className="panel">
          <div className="unit">With Nightshift Cloak</div>
          <table style={{ marginTop: 8 }}>
            <tbody>
              <tr><td className="muted">Collateral / debt / liq. price</td><td className="num">hidden</td></tr>
              <tr><td className="muted">Oracle price (public)</td><td className="num">{usd(priceCents / 100)}</td></tr>
              <tr><td className="muted">Market LLTV (public)</td><td className="num">{(lltvBps / 100).toFixed(1)}%</td></tr>
              <tr>
                <td className="muted">Commitment</td>
                <td className="num xs">{commitment ? `${commitment.slice(0, 10)}…${commitment.slice(-6)}` : "–"}</td>
              </tr>
              <tr>
                <td className="muted">ZK proof: HF &gt; 1</td>
                <td className="num">
                  {!verdict ? (
                    <span className="muted">not proven</span>
                  ) : verdict.accepted ? (
                    <span className="up">Verified</span>
                  ) : (
                    <span className="down">Rejected</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            <button className="btn" onClick={prove} disabled={!!busy}>
              {busy === "prove" ? "Proving in your browser…" : "Generate ZK proof"} <span>↗</span>
            </button>
            {proved && (
              <>
                <button className="tab" onClick={() => verify(proved, false)} disabled={!!busy}>
                  Re-verify
                </button>
                <button className="tab danger" onClick={() => verify(proved, true)} disabled={!!busy}>
                  Tamper: fake 2× price
                </button>
                <button
                  className="tab"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(JSON.stringify({ token: proved.token, proof: proved.proof, publicSignals: proved.publicSignals }));
                      toast("Proof copied. Anyone can paste it into the verifier below.", "ok");
                    } catch {
                      toast("Couldn't access the clipboard", "error");
                    }
                  }}
                >
                  Copy proof
                </button>
                {isDeployed && (
                  <button
                    className="tab"
                    disabled={onchain === "checking"}
                    onClick={async () => {
                      setOnchain("checking");
                      try {
                        const v = await verifyOnChain(proved.proof, proved.publicSignals, proved.token);
                        if (!v || !v.math) {
                          setOnchain("invalid");
                          toast(`The verifier contract on ${DEPLOYMENT.chainName} rejected this proof.`, "error");
                        } else if (v.accepted) {
                          setOnchain("valid");
                          toast(`Verified on ${DEPLOYMENT.chainName}: the contract accepted the proof, and its price ($${(v.price!.proofCents / 100).toFixed(2)}) and LLTV match the on-chain Oracle and Vault.`, "ok");
                        } else {
                          setOnchain("math-only");
                          const why = [
                            v.price && !v.price.ok ? `its price $${(v.price.proofCents / 100).toFixed(2)} differs from the on-chain Oracle's $${(v.price.onchainCents / 100).toFixed(2)}` : "",
                            v.lltv && !v.lltv.ok ? `its LLTV ${v.lltv.proofBps / 100}% differs from the market's ${v.lltv.onchainBps / 100}%` : "",
                          ].filter(Boolean).join(" and ");
                          toast(`The math checks out on ${DEPLOYMENT.chainName}, but ${why || "the price couldn't be compared"}, so this doesn't prove solvency at the protocol's price.`, "warn");
                        }
                      } catch (e) {
                        setOnchain("");
                        toast(`On-chain check failed: ${String(e).slice(0, 120)}`, "error");
                      }
                    }}
                  >
                    {onchain === "checking"
                      ? "Checking on-chain…"
                      : onchain === "valid"
                        ? "Verified on-chain ✓ (proof + Oracle price)"
                        : onchain === "math-only"
                          ? "Math ✓, price ≠ on-chain Oracle"
                          : onchain === "invalid"
                            ? "Rejected on-chain"
                            : "Verify on-chain"}
                  </button>
                )}
              </>
            )}
          </div>
          {error && <div className="small down" style={{ marginTop: 10 }}>{error}</div>}
        </div>
      </div>

      {proved && (
        <div className="panel">
          <div className="unit">Proof receipt · Groth16 · BN254 · 918 constraints</div>
          <div className="grid cols-4" style={{ marginTop: 10 }}>
            <div className="stat"><div className="k">Proved in browser</div><div className="v">{proved.proveMs} ms</div></div>
            <div className="stat"><div className="k">Proof size</div><div className="v">{proofBytes} B</div></div>
            <div className="stat"><div className="k">Server verify</div><div className="v">{verdict ? `${verdict.verifyMs} ms` : "…"}</div></div>
            <div className="stat">
              <div className="k">Verdict{verdict?.tampered ? " (tampered input)" : ""}</div>
              <div className={`v ${verdict?.accepted ? "up" : "down"}`}>{verdict ? (verdict.accepted ? "Accepted" : "Rejected") : "…"}</div>
            </div>
          </div>
          {verdict && (
            <table style={{ marginTop: 10 }}>
              <tbody>
                <tr>
                  <td className="muted">Cryptographic proof valid</td>
                  <td className={`num ${verdict.checks.proof ? "up" : "down"}`}>{verdict.checks.proof ? "yes" : "no"}</td>
                </tr>
                <tr>
                  <td className="muted">Proven price matches live Oracle ({verdict.checks.oracleCents != null ? usd(verdict.checks.oracleCents / 100) : "–"})</td>
                  <td className={`num ${verdict.checks.priceMatchesOracle ? "up" : "down"}`}>{verdict.checks.priceMatchesOracle ? "yes" : "no"}</td>
                </tr>
                <tr>
                  <td className="muted">LLTV matches market</td>
                  <td className={`num ${verdict.checks.lltvMatchesMarket ? "up" : "down"}`}>{verdict.checks.lltvMatchesMarket ? "yes" : "no"}</td>
                </tr>
              </tbody>
            </table>
          )}
          <details style={{ marginTop: 10 }}>
            <summary className="xs mono accent" style={{ cursor: "pointer" }}>View raw proof and public signals</summary>
            <div className="code" style={{ marginTop: 8, maxHeight: 220, overflow: "auto" }}>
              {JSON.stringify({ publicSignals: proved.publicSignals, proof: proved.proof }, null, 1)}
            </div>
          </details>
          <p className="xs muted" style={{ marginBottom: 0 }}>
            The circuit proves <span className="mono">units × price × LLTV &gt; debt</span> and{" "}
            <span className="mono">commitment = Poseidon(units, debt, salt)</span>. Collateral, debt and salt never leave this browser;
            the server sees only the proof, the commitment, the price and the LLTV. Trusted setup: PSE Perpetual Powers of Tau
            (phase 1) + a single demo contribution (phase 2).
          </p>
        </div>
      )}
    </div>
  );
}

/** Anyone can check a proof someone shared with them: paste it, verify it against the live Oracle. */
export function VerifyProof() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<(Omit<Verdict, "tampered"> & { error?: string }) | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const parsed = JSON.parse(text);
      if (!parsed.token || !parsed.proof || !Array.isArray(parsed.publicSignals)) throw new Error("Expected { token, proof, publicSignals }.");
      const res = await fetch("/api/zk/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: parsed.token, proof: parsed.proof, publicSignals: parsed.publicSignals }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setResult(json);
    } catch (e) {
      setResult({ valid: false, accepted: false, verifyMs: 0, checks: { proof: false, priceMatchesOracle: false, lltvMatchesMarket: false, oracleCents: null }, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel verify">
      <div className="unit">Verify a shared proof</div>
      <p className="small muted" style={{ margin: "8px 0 12px" }}>
        Paste a proof copied from the Cloak. The server checks the cryptography and that its price matches the live Oracle. You
        learn the loan is safe, and nothing about its size.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='{"token":"SPY","proof":{…},"publicSignals":["…","77849","7700"]}'
        rows={4}
        spellCheck={false}
        aria-label="Proof JSON"
      />
      <div className="row-actions">
        <button className="btn" onClick={run} disabled={!text.trim() || busy}>
          {busy ? "Verifying…" : "Verify proof"} <span>↗</span>
        </button>
        {result && (
          <span className={`verdict ${result.accepted ? "up" : "down"}`}>
            {result.error
              ? `Invalid input: ${result.error}`
              : result.accepted
                ? `Accepted · solvent at ${usd((result.checks.oracleCents ?? 0) / 100)} · ${result.verifyMs} ms`
                : `Rejected · ${!result.checks.proof ? "proof is not valid" : !result.checks.priceMatchesOracle ? "price doesn't match the live Oracle (proof may be stale)" : "LLTV doesn't match the market"}`}
          </span>
        )}
      </div>
    </div>
  );
}
