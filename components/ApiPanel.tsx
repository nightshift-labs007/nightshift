"use client";

import { useState } from "react";
import { toast } from "./Toast";

const ENDPOINTS = [
  { path: "/api/oracle", what: "All assets: fair value, confidence, per-signal estimates" },
  { path: "/api/oracle/SPY", what: "One asset" },
  { path: "/api/series?token=SPY&range=12H", what: "Fair-value history (1H · 4H · 12H · 24H)" },
  { path: "/api/shift-report", what: "Predicted vs. actual opens, last 10 sessions" },
];

export function ApiPanel() {
  const [active, setActive] = useState(1);
  const [body, setBody] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const run = async (i: number) => {
    setActive(i);
    setBusy(true);
    try {
      const res = await fetch(ENDPOINTS[i].path);
      const json = await res.json();
      const text = JSON.stringify(json, null, 2);
      setBody(text.length > 2400 ? `${text.slice(0, 2400)}\n…` : text);
    } catch (e) {
      setBody(String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied to clipboard", "ok");
    } catch {
      toast("Couldn't access the clipboard", "error");
    }
  };

  return (
    <div className="panel api-panel">
      <div className="unit">Public API · JSON · CORS enabled · no key required</div>
      <ul className="endpoints">
        {ENDPOINTS.map((e, i) => (
          <li key={e.path} className={i === active ? "on" : ""}>
            <button className="endpoint" onClick={() => run(i)}>
              <span className="verb">GET</span>
              <code>{e.path}</code>
              <small>{e.what}</small>
            </button>
            <button className="copy" onClick={() => copy(`curl ${origin}${e.path}`)} aria-label={`Copy curl command for ${e.path}`}>
              Copy curl
            </button>
          </li>
        ))}
      </ul>
      <div className="api-response">
        <div className="api-response-head">
          <span>{busy ? "Requesting…" : body ? `Response · ${ENDPOINTS[active].path}` : "Click an endpoint to call it live"}</span>
          {body && (
            <button className="copy" onClick={() => copy(body)}>
              Copy JSON
            </button>
          )}
        </div>
        <pre className="code">{body || "// Live responses appear here."}</pre>
      </div>
    </div>
  );
}
