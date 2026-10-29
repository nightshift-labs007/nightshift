"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { OracleSnapshot } from "@/lib/oracle";
import { guardianTick, healthFactor, lif, SLIPPAGE, useAccount } from "@/lib/paper";
import { toast } from "./Toast";
import { usd } from "./useApi";
import { marksFrom } from "./VaultApp";
import { VaultGuardian } from "./VaultGuardian";

function notify(title: string, body: string) {
  try {
    if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body, icon: "/icon.svg" });
  } catch {
    // notifications unavailable
  }
}

export function GuardianConsole({ snap }: { snap: OracleSnapshot }) {
  const account = useAccount();
  const marks = useMemo(() => marksFrom(snap.quotes), [snap.quotes]);
  const [lastCheck, setLastCheck] = useState<number | null>(null);
  const [perm, setPerm] = useState<string>("default");
  const [shock, setShock] = useState(-8);
  const seen = useRef<string>("");

  useEffect(() => {
    if ("Notification" in window) setPerm(Notification.permission);
  }, []);

  const check = (manual = false) => {
    const r = guardianTick(marks);
    setLastCheck(Date.now());
    r.alerts.forEach((a) => {
      toast(`Guardian alert · ${a.id}: ${a.msg}`, "warn");
      notify(`Nightshift Guardian · ${a.token}`, a.msg);
    });
    r.actions.forEach((a) => {
      toast(`Guardian · ${a.id}: ${a.msg}`, a.msg.startsWith("Liquidated") ? "error" : "ok");
      notify("Nightshift Guardian", a.msg);
    });
    if (manual && !r.alerts.length && !r.actions.length) toast(r.checked ? `Checked ${r.checked} loan(s): all within rules.` : "No open loans to check.", "info");
  };

  // run on every fresh Oracle snapshot
  useEffect(() => {
    if (seen.current === snap.updatedAt) return;
    seen.current = snap.updatedAt;
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.updatedAt]);

  const open = account.positions.filter((p) => p.status === "open");
  const feed = account.positions
    .flatMap((p) => p.events.filter((e) => e.kind === "alert" || e.kind === "protect" || e.kind === "liquidated").map((e) => ({ ...e, id: p.id })))
    .sort((a, b) => b.t - a.t)
    .slice(0, 8);

  const shockRows = open.map((p) => {
    const m = marks[p.token];
    const P = m.price * (1 + shock / 100);
    const hf = healthFactor(p.units, P, p.debt, p.lltv);
    let outcome: { text: string; tone: string };
    if (p.debt <= 0) outcome = { text: "No debt", tone: "muted" };
    else if (hf < 1 && p.guardian.mode !== "auto") outcome = { text: `Liquidated · −${usd(p.debt * (lif(p.lltv) - 1), 0)} penalty`, tone: "down" };
    else if (hf < p.guardian.trigger && p.guardian.mode === "auto") {
      const T = p.guardian.target;
      const k = Math.max(0, Math.min(p.units, (P * p.units * p.lltv - T * p.debt) / (P * (p.lltv - T * (1 - SLIPPAGE)))));
      outcome = { text: `Auto-protect uses ${k.toFixed(3)} ${p.token} to repay → HF ${T.toFixed(2)}`, tone: "accent" };
    } else if (hf < p.guardian.trigger && p.guardian.mode === "alert") outcome = { text: hf < 1 ? "Alert, then liquidated" : "Alert sent", tone: hf < 1 ? "down" : "amber" };
    else if (hf < 1) outcome = { text: "Liquidated", tone: "down" };
    else outcome = { text: "Within rules", tone: "up" };
    return { p, P, hf, outcome };
  });

  return (
    <div className="guardian">
      <div className="grid cols-2">
        <div className="panel">
          <div className="panel-head">
            <span className="unit">Live monitor · {open.length} loan{open.length === 1 ? "" : "s"}</span>
            <span className="xs muted mono">{lastCheck ? `last check ${new Date(lastCheck).toLocaleTimeString()} · every Oracle update` : "waiting for first check"}</span>
          </div>
          {open.length === 0 ? (
            <p className="small muted">No loans to watch yet. <a href="#vault">Open a loan above</a> and the Guardian starts watching it on the next price update.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Loan</th>
                    <th className="num">Oracle price</th>
                    <th className="num">Health</th>
                    <th className="num">Trigger</th>
                    <th>Rule</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((p) => {
                    const hf = healthFactor(p.units, marks[p.token].price, p.debt, p.lltv);
                    return (
                      <tr key={p.id}>
                        <td className="mono">
                          {p.id} · {p.token}
                        </td>
                        <td className="num">{usd(marks[p.token].price)}</td>
                        <td className={`num ${hf < 1.1 ? "down" : hf < p.guardian.trigger ? "amber" : "up"}`}>{Number.isFinite(hf) ? hf.toFixed(2) : "∞"}</td>
                        <td className="num">{p.guardian.trigger.toFixed(2)}</td>
                        <td>{p.guardian.mode === "auto" ? `Auto → ${p.guardian.target.toFixed(2)}` : p.guardian.mode === "alert" ? "Alert" : "Off"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="row-actions">
            <button className="tab" onClick={() => check(true)}>
              Run check now
            </button>
            {perm !== "granted" ? (
              <button
                className="tab"
                onClick={async () => {
                  if (!("Notification" in window)) return toast("This browser doesn't support notifications.", "warn");
                  const r = await Notification.requestPermission();
                  setPerm(r);
                  toast(r === "granted" ? "Browser alerts on." : "Browser alerts blocked.", r === "granted" ? "ok" : "warn");
                }}
              >
                Enable browser alerts
              </button>
            ) : (
              <span className="xs muted mono">Browser alerts on</span>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="unit">Guardian activity</div>
          {feed.length === 0 ? (
            <p className="small muted">No alerts or actions yet. They appear here, as toasts, and as browser notifications if enabled.</p>
          ) : (
            <ol className="log feed">
              {feed.map((e, i) => (
                <li key={i} className={e.kind === "liquidated" ? "down" : e.kind === "alert" ? "amber" : "accent"}>
                  <span className="muted">
                    [{new Date(e.t).toLocaleTimeString()}] {e.id}
                  </span>{" "}
                  {e.msg}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className="panel shock">
        <div className="panel-head">
          <span className="unit">Shock test your positions</span>
          <span className="xs muted mono">Preview only. Positions are not changed.</span>
        </div>
        <label className="field">
          If prices gap {shock >= 0 ? "+" : ""}
          {shock}% from the current Oracle value
        </label>
        <input type="range" min={-30} max={10} step={0.5} value={shock} onChange={(e) => setShock(Number(e.target.value))} />
        {shockRows.length === 0 ? (
          <p className="small muted">Open a position to shock-test it.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Loan</th>
                  <th className="num">Shocked price</th>
                  <th className="num">Health after</th>
                  <th>What the Guardian does</th>
                </tr>
              </thead>
              <tbody>
                {shockRows.map(({ p, P, hf, outcome }) => (
                  <tr key={p.id}>
                    <td className="mono">
                      {p.id} · {p.token}
                    </td>
                    <td className="num">{usd(P)}</td>
                    <td className={`num ${hf < 1 ? "down" : hf < p.guardian.trigger ? "amber" : "up"}`}>{Number.isFinite(hf) ? hf.toFixed(2) : "∞"}</td>
                    <td className={outcome.tone}>{outcome.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <details className="panel walkthrough">
        <summary>
          <span className="unit">Weekend walkthrough</span> Friday close → Sunday warning → Monday gap, step by step
        </summary>
        <VaultGuardian quotes={snap.quotes} />
      </details>
    </div>
  );
}
