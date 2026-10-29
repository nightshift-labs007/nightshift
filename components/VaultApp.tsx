"use client";

import { useMemo, useState } from "react";
import type { Quote } from "@/lib/oracle";
import { InfoTip } from "./InfoTip";
import {
  adjust,
  borrowLimit,
  closePosition,
  healthFactor,
  liquidationPrice,
  MIN_OPEN_HF,
  openPosition,
  removeClosed,
  resetAccount,
  setGuardian,
  useAccount,
  type GuardianMode,
  type Mark,
  type Marks,
  type Position,
} from "@/lib/paper";
import { toast } from "./Toast";
import { usd } from "./useApi";

export const marksFrom = (quotes: Quote[]): Marks =>
  Object.fromEntries(quotes.map((q) => [q.token, { price: q.fairValue, frozen: q.lastClose, confidence: q.confidence, lltv: q.lltv }]));

export const selectForCloak = (id: string) => {
  try {
    sessionStorage.setItem("ns.cloak.pick", id);
  } catch {
    /* storage unavailable */
  }
  window.location.href = "/proof#cloak";
};

const fmtUnits = (x: number) => (Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : x.toFixed(4));
const hfClass = (hf: number) => (hf < 1.1 ? "down" : hf < 1.3 ? "amber" : "up");
const hfText = (hf: number) => (Number.isFinite(hf) ? hf.toFixed(2) : "∞");

export function VaultApp({ quotes }: { quotes: Quote[] }) {
  const account = useAccount();
  const marks = useMemo(() => marksFrom(quotes), [quotes]);
  const [token, setToken] = useState("SPY");
  const [units, setUnits] = useState("5");
  const [pct, setPct] = useState(60);
  const m = marks[token];
  const u = Number(units) || 0;
  const limit = m ? borrowLimit(u, m) : 0;
  const frozenLimit = m ? u * m.frozen * m.lltv : 0;
  const borrow = Math.floor(((limit * pct) / 100) * 100) / 100;
  const hfOpen = m ? healthFactor(u, m.price, borrow, m.lltv) : Infinity;
  const held = account.wallet[token] ?? 0;

  const walletValue = Object.entries(account.wallet).reduce((s, [t, n]) => s + n * (marks[t]?.price ?? 0), 0) + account.usdg;
  const open = account.positions.filter((p) => p.status === "open");
  const totalDebt = open.reduce((s, p) => s + p.debt, 0);
  const totalColl = open.reduce((s, p) => s + p.units * (marks[p.token]?.price ?? 0), 0);

  const submit = () => {
    if (!m) return;
    if (hfOpen < MIN_OPEN_HF) return toast(`Opening health factor must be at least ${MIN_OPEN_HF}.`, "warn");
    const err = openPosition(token, u, borrow, m);
    if (err) toast(err, "error");
    else toast(`Position opened: ${u} ${token}, ${usd(borrow)} USDG borrowed.`, "ok");
  };

  return (
    <div className="vault">
      <div className="vault-top">
        <div className="panel wallet">
          <div className="panel-head">
            <span className="unit">Paper wallet · stored in this browser</span>
            <button
              className="link-btn"
              onClick={() => {
                if (confirm("Reset the paper account? All positions and history are cleared.")) {
                  resetAccount();
                  toast("Paper account reset", "info");
                }
              }}
            >
              Reset
            </button>
          </div>
          <div className="wallet-total">
            <small>Wallet value at Oracle prices</small>
            <b>{usd(walletValue)}</b>
          </div>
          <ul className="balances">
            {Object.entries(account.wallet).map(([t, n]) => (
              <li key={t}>
                <span className="tok">{t}</span>
                <span className="mono">{fmtUnits(n)}</span>
                <span className="muted mono">{marks[t] ? usd(n * marks[t].price, 0) : "—"}</span>
              </li>
            ))}
            <li>
              <span className="tok">USDG</span>
              <span className="mono">{usd(account.usdg)}</span>
              <span className="muted mono">borrowed cash</span>
            </li>
          </ul>
          <div className="wallet-stats">
            <div>
              <small>In vault</small>
              <b>{usd(totalColl, 0)}</b>
            </div>
            <div>
              <small>Total debt</small>
              <b>{usd(totalDebt, 0)}</b>
            </div>
            <div>
              <small>Open loans</small>
              <b>{open.length}</b>
            </div>
          </div>
        </div>

        <div className="panel open-form">
          <div className="unit">Open a position · Morpho-style market</div>
          <div className="tabs" style={{ margin: "14px 0 0" }}>
            {quotes.map((q) => (
              <button key={q.token} className={`tab ${q.token === token ? "on" : ""}`} onClick={() => setToken(q.token)}>
                {q.token}
              </button>
            ))}
          </div>
          <label className="field" htmlFor="open-units">
            Collateral · you hold {fmtUnits(held)} {token}
          </label>
          <div className="input-row">
            <input id="open-units" type="number" min={0} step="any" value={units} onChange={(e) => setUnits(e.target.value)} />
            <button className="tab" onClick={() => setUnits(String(held))}>
              Max
            </button>
          </div>
          <label className="field" htmlFor="open-borrow">
            Borrow {usd(borrow)} USDG · {pct}% of the Nightshift limit
          </label>
          <input id="open-borrow" type="range" min={0} max={95} value={pct} onChange={(e) => setPct(Number(e.target.value))} />
          {m && (
            <div className="readout">
              <div className="kv">
                <span className="muted">Collateral value (Oracle)</span>
                <span className="mono">{usd(u * m.price)}</span>
              </div>
              <div className="kv">
                <span className="muted">Limit, frozen-close oracle</span>
                <span className="mono">{usd(frozenLimit)}</span>
              </div>
              <div className="kv">
                <span className="muted">Limit, Nightshift (LLTV {(m.lltv * 100).toFixed(1)}%, confidence {m.confidence})</span>
                <span className="mono">{usd(limit)}</span>
              </div>
              <div className="kv">
                <span className="muted">Health factor <InfoTip k="health" label="health factor" /> · liquidation price <InfoTip k="liquidationPrice" label="liquidation price" /></span>
                <span className="mono">
                  <b className={hfClass(hfOpen)}>{hfText(hfOpen)}</b> · {borrow > 0 ? usd(liquidationPrice({ units: u, debt: borrow, lltv: m.lltv })) : "—"}
                </span>
              </div>
            </div>
          )}
          <button className="btn" onClick={submit} disabled={!m || !(u > 0) || u > held + 1e-9}>
            Open position <span>↗</span>
          </button>
        </div>
      </div>

      <div className="positions">
        <div className="positions-head">
          <span className="unit">Your positions</span>
          {account.positions.some((p) => p.status !== "open") && (
            <button className="link-btn" onClick={removeClosed}>
              Clear closed
            </button>
          )}
        </div>
        {account.positions.length === 0 ? (
          <div className="empty panel">
            <b>No loans yet.</b>
            <span>Your practice account is already funded: pick a token and an amount above, then press Open position. It takes under a minute.</span>
          </div>
        ) : (
          account.positions.map((p) => <PositionCard key={p.id} p={p} m={marks[p.token]} usdg={account.usdg} />)
        )}
      </div>
    </div>
  );
}

function PositionCard({ p, m, usdg }: { p: Position; m?: Mark; usdg: number }) {
  const [amt, setAmt] = useState("");
  const [showLog, setShowLog] = useState(false);
  if (!m) return null;
  const isOpen = p.status === "open";
  const hf = healthFactor(p.units, m.price, p.debt, p.lltv);
  const hfFrozen = healthFactor(p.units, m.frozen, p.debt, p.lltv);
  const liq = liquidationPrice(p);
  const cushion = p.debt > 0 ? (1 - liq / m.price) * 100 : 100;
  const bar = Math.max(2, Math.min(100, ((Number.isFinite(hf) ? hf : 3) - 1) * 50));

  const run = (action: "borrow" | "repay" | "deposit" | "withdraw") => {
    const err = adjust(p.id, action, Number(amt), m);
    if (err) toast(err, "error");
    else {
      toast(`${p.id}: ${action === "deposit" ? "collateral added" : action === "withdraw" ? "collateral withdrawn" : action === "borrow" ? "borrowed" : "repaid"}`, "ok");
      setAmt("");
    }
  };

  return (
    <article className={`panel position ${p.status}`}>
      <header className="position-head">
        <div>
          <span className="pos-id mono">{p.id}</span>
          <h3>
            {fmtUnits(p.units)} {p.token}
          </h3>
          <span className="xs muted">opened {new Date(p.openedAt).toLocaleString()} at {usd(p.openPrice)}</span>
        </div>
        <span className={`pill-status ${p.status === "open" ? (hf < p.guardian.trigger ? "warn" : "ok") : p.status}`}>
          {p.status === "open" ? (hf < p.guardian.trigger ? "At risk" : "Healthy") : p.status === "closed" ? "Closed" : "Liquidated"}
        </span>
      </header>

      <div className="pos-metrics">
        <div>
          <small>Collateral value</small>
          <b>{usd(p.units * m.price, 0)}</b>
        </div>
        <div>
          <small>Debt</small>
          <b>{usd(p.debt, 0)}</b>
        </div>
        <div>
          <small>Health · Oracle / frozen <InfoTip k="health" label="health" /></small>
          <b>
            <span className={hfClass(hf)}>{hfText(hf)}</span> <span className="muted">/ {hfText(hfFrozen)}</span>
          </b>
        </div>
        <div>
          <small>Liquidation price <InfoTip k="liquidationPrice" label="liquidation price" /></small>
          <b>{p.debt > 0 ? usd(liq) : "—"}</b>
          {p.debt > 0 && <span className="xs muted">{cushion.toFixed(1)}% below Oracle</span>}
        </div>
      </div>

      {isOpen && (
        <>
          <div className="health-track" aria-label={`Health factor ${hfText(hf)}`}>
            <i className={hfClass(hf)} style={{ width: `${bar}%` }} />
            <span className="mark" style={{ left: `${(p.guardian.trigger - 1) * 50}%` }} title="Guardian trigger" />
          </div>
          <div className="pos-actions">
            <input type="number" min={0} step="any" placeholder="Amount" value={amt} onChange={(e) => setAmt(e.target.value)} aria-label="Amount" />
            <button className="tab" onClick={() => run("repay")}>
              Repay USDG
            </button>
            <button className="tab" onClick={() => run("borrow")}>
              Borrow USDG
            </button>
            <button className="tab" onClick={() => run("deposit")}>
              Add {p.token}
            </button>
            <button className="tab" onClick={() => run("withdraw")}>
              Withdraw {p.token}
            </button>
            <button
              className="tab"
              onClick={() => {
                const err = closePosition(p.id);
                if (err) toast(err, "error");
                else toast(`${p.id} closed`, "ok");
              }}
              disabled={p.debt > usdg + 1e-9}
              title={p.debt > usdg ? "Not enough USDG to repay" : "Repay all and return collateral"}
            >
              Close
            </button>
          </div>

          <div className="guardian-row">
            <span className="unit">Guardian</span>
            <div className="seg small">
              {(["off", "alert", "auto"] as GuardianMode[]).map((g) => (
                <button key={g} className={p.guardian.mode === g ? "on" : ""} onClick={() => setGuardian(p.id, { mode: g })}>
                  {g === "off" ? "Off" : g === "alert" ? "Alert me" : "Auto-protect"}
                </button>
              ))}
            </div>
            <label className="mini">
              Trigger HF <b>{p.guardian.trigger.toFixed(2)}</b>
              <input type="range" min={1.02} max={1.6} step={0.01} value={p.guardian.trigger} onChange={(e) => setGuardian(p.id, { trigger: Number(e.target.value) })} />
            </label>
            {p.guardian.mode === "auto" && (
              <label className="mini">
                Restore to <b>{p.guardian.target.toFixed(2)}</b>
                <input
                  type="range"
                  min={Math.max(1.1, p.guardian.trigger + 0.05)}
                  max={2.5}
                  step={0.05}
                  value={p.guardian.target}
                  onChange={(e) => setGuardian(p.id, { target: Number(e.target.value) })}
                />
              </label>
            )}
            <button className="link-btn" onClick={() => selectForCloak(p.id)}>
              Prove with Cloak →
            </button>
          </div>
        </>
      )}

      <button className="link-btn log-toggle" onClick={() => setShowLog(!showLog)} aria-expanded={showLog}>
        {showLog ? "Hide" : "Show"} activity ({p.events.length})
      </button>
      {showLog && (
        <ol className="log">
          {p.events.map((e, i) => (
            <li key={i} className={e.kind === "liquidated" ? "down" : e.kind === "alert" ? "amber" : e.kind === "protect" ? "accent" : ""}>
              <span className="muted">[{new Date(e.t).toLocaleTimeString()}]</span> {e.msg}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
