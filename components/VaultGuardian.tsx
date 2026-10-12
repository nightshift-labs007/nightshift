"use client";

import { useEffect, useMemo, useState } from "react";
import type { Quote } from "@/lib/oracle";
import { signed, usd } from "./useApi";

type Mode = "off" | "alert" | "auto";

const SLIPPAGE = 0.005; // thin weekend liquidity
const TRIGGER_HF = 1.15;
const TARGET_HF = 1.4;

// Morpho Blue liquidation incentive factor.
const lif = (lltv: number) => Math.min(1.15, 1 / (0.3 * lltv + 0.7));
const hf = (units: number, price: number, debt: number, lltv: number) => (debt > 0 ? (units * price * lltv) / debt : Infinity);

function mondayOutcome(units: number, debt: number, price: number, lltv: number) {
  const health = hf(units, price, debt, lltv);
  const value = units * price;
  if (health >= 1) return { liquidated: false, equity: value - debt, penalty: 0, health };
  const seized = Math.min(value, debt * lif(lltv));
  return { liquidated: true, equity: value - seized, penalty: seized - Math.min(debt, seized), health };
}

export function VaultGuardian({ quotes }: { quotes: Quote[] }) {
  const [i, setI] = useState(0);
  const q = quotes[i];
  const [units, setUnits] = useState(10);
  const [debtPct, setDebtPct] = useState(70); // % of stale-oracle borrow limit
  const [gap, setGap] = useState(-8);
  const [mode, setMode] = useState<Mode>("auto");

  useEffect(() => {
    if (q?.token === "IBIT") setUnits(100);
    else setUnits(10);
  }, [q?.token]);

  const sim = useMemo(() => {
    if (!q) return null;
    const l = q.lltv;
    const P0 = q.lastClose;
    const F = q.fairValue;
    const staleLimit = units * P0 * l;
    const haircut = (100 - q.confidence) / 200;
    const safeLimit = units * Math.min(P0, F) * l * (1 - haircut);
    const debt = (staleLimit * debtPct) / 100;

    const monday = P0 * (1 + gap / 100);
    const sundayView = P0 * (1 + (0.8 * gap) / 100); // Oracle has caught 80% of the move by Sunday night

    const log: { t: string; msg: string; tone?: string }[] = [
      { t: "FRI 16:00", msg: `Wall Street closes. ${q.token} last trade ${usd(P0)}. Standard oracles freeze here.` },
      { t: "FRI 16:00", msg: `Position: ${units} ${q.token} collateral, ${usd(debt, 0)} USDG debt. HF ${hf(units, P0, debt, l).toFixed(2)}.` },
    ];

    let gUnits = units;
    let gDebt = debt;
    const hfSunday = hf(units, sundayView, debt, l);
    log.push({
      t: "SUN 21:00",
      msg: `Oracle fair value ${usd(sundayView)} (${signed(((sundayView / P0) - 1) * 100)}). Projected HF ${hfSunday.toFixed(2)}. Stale feed still says ${hf(units, P0, debt, l).toFixed(2)}.`,
      tone: hfSunday < TRIGGER_HF ? "amber" : undefined,
    });

    if (mode === "off") {
      log.push({ t: "SUN 21:00", msg: "Guardian offline. No action taken.", tone: "muted" });
    } else if (hfSunday >= TRIGGER_HF) {
      log.push({ t: "SUN 21:00", msg: `Guardian: position within safety band (> ${TRIGGER_HF}). Standing watch.`, tone: "accent" });
    } else if (mode === "alert") {
      log.push({ t: "SUN 21:01", msg: "Guardian ALERT sent to user: weekend risk detected. No pre-approved action, so the user must act.", tone: "amber" });
    } else {
      const P = sundayView;
      const sell = (P * units * l - TARGET_HF * debt) / (P * (l - TARGET_HF * (1 - SLIPPAGE)));
      const k = Math.max(0, Math.min(units, sell));
      const repaid = k * P * (1 - SLIPPAGE);
      gUnits = units - k;
      gDebt = Math.max(0, debt - repaid);
      log.push({
        t: "SUN 21:01",
        msg: `Guardian AUTO-DEFEND: sold ${k.toFixed(3)} ${q.token} at ~${usd(P * (1 - SLIPPAGE))}, repaid ${usd(repaid, 0)} USDG. HF restored to ${hf(gUnits, P, gDebt, l).toFixed(2)}.`,
        tone: "accent",
      });
    }

    const unguarded = mondayOutcome(units, debt, monday, l);
    const guarded = mondayOutcome(gUnits, gDebt, monday, l);
    const final = mode === "auto" ? guarded : unguarded;
    log.push({
      t: "MON 09:30",
      msg: `Opening bell: ${q.token} opens at ${usd(monday)} (${signed(gap)}). HF ${final.health.toFixed(2)}.`,
    });
    log.push(
      final.liquidated
        ? { t: "MON 09:30", msg: `Liquidation bots strike. Penalty ${usd(final.penalty, 0)}.`, tone: "down" }
        : { t: "MON 09:30", msg: "Bots scan the chain and find nothing to hunt. Position survives the night.", tone: "up" },
    );

    return { staleLimit, safeLimit, debt, monday, unguarded, guarded, log, hfNow: hf(units, P0, debt, l), hfFair: hf(units, F, debt, l) };
  }, [q, units, debtPct, gap, mode]);

  if (!q || !sim) return <div className="skeleton">Opening vault<span className="blink">_</span></div>;

  return (
    <div className="grid cols-2">
      <div className="panel">
        <div className="unit">Morpho-style market · LLTV {(q.lltv * 100).toFixed(1)}%</div>
        <label className="field">Collateral token</label>
        <div className="tabs" style={{ margin: 0 }}>
          {quotes.map((x, j) => (
            <button key={x.token} className={`tab ${j === i ? "on" : ""}`} onClick={() => setI(j)}>
              {x.token}
            </button>
          ))}
        </div>

        <label className="field">Units deposited ({usd(units * q.lastClose, 0)})</label>
        <input type="number" min={1} value={units} onChange={(e) => setUnits(Math.max(1, Number(e.target.value) || 1))} />

        <label className="field">
          Borrow {usd(sim.debt, 0)} USDG ({debtPct}% of limit)
        </label>
        <input type="range" min={10} max={100} value={debtPct} onChange={(e) => setDebtPct(Number(e.target.value))} />

        <div className="kv small">
          <span className="muted">Limit, stale oracle</span>
          <span className="mono">{usd(sim.staleLimit, 0)}</span>
        </div>
        <div className="kv small">
          <span className="muted">Limit, Nightshift (fair value + confidence haircut)</span>
          <span className="mono accent">{usd(sim.safeLimit, 0)}</span>
        </div>
        <div className="kv small">
          <span className="muted">Health factor: stale / fair</span>
          <span className="mono">
            {sim.hfNow.toFixed(2)} / <span className={sim.hfFair < 1.1 ? "down" : "accent"}>{sim.hfFair.toFixed(2)}</span>
          </span>
        </div>

        <label className="field">Weekend scenario: Monday gap {signed(gap, 1)}</label>
        <input type="range" min={-20} max={6} step={0.5} value={gap} onChange={(e) => setGap(Number(e.target.value))} />
        <button className="tab" style={{ marginTop: 8 }} onClick={() => setGap(Math.round(q.driftPct * 2) / 2)}>
          Use live Oracle drift ({signed(q.driftPct, 1)})
        </button>

        <label className="field">Guardian</label>
        <div className="seg">
          {(["off", "alert", "auto"] as Mode[]).map((m) => (
            <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
              {m === "off" ? "Off" : m === "alert" ? "Alert only" : "Auto-protect"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid" style={{ alignContent: "start" }}>
        <div className="grid cols-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <Outcome title="Unguarded" o={sim.unguarded} />
          <Outcome title={mode === "auto" ? "Guardian on" : "Guardian (needs auto)"} o={mode === "auto" ? sim.guarded : sim.unguarded} />
        </div>
        <div className="log">
          {sim.log.map((l, j) => (
            <div key={j} className={l.tone}>
              <span className="muted">[{l.t}]</span> {l.msg}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Outcome({ title, o }: { title: string; o: ReturnType<typeof mondayOutcome> }) {
  return (
    <div className={`outcome ${o.liquidated ? "bad" : "good"}`}>
      <div className="xs mono muted">{title}</div>
      <div className="big">{usd(o.equity, 0)}</div>
      <div className="xs mono">{o.liquidated ? `Liquidated · −${usd(o.penalty, 0)} penalty` : `Survived · HF ${o.health.toFixed(2)}`}</div>
    </div>
  );
}
