"use client";

import { useEffect, useState } from "react";
import type { SentoraEarn } from "@/lib/earn/sentora";
import { useAccount } from "@/lib/paper";
import { usd, useApi } from "./useApi";

const pctFmt = (x: number | null, d = 2) => (x === null ? "—" : `${x.toFixed(d)}%`);
const compact = (x: number) => (x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(1)}K` : usd(x));

function ApySpark({ points }: { points: SentoraEarn["history"] }) {
  if (points.length < 2) return null;
  const w = 320;
  const h = 64;
  const ys = points.map((p) => p.apy);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const xy = ys.map((v, i) => [(i / (ys.length - 1)) * w, h - 4 - ((v - lo) / (hi - lo || 1)) * (h - 8)]);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <figure className="earn-spark">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-label="Daily APY over the last 30 days">
        <polygon points={`0,${h} ${line} ${w},${h}`} className="earn-area" />
        <polyline points={line} className="earn-line" />
      </svg>
      <figcaption className="mono">
        <span>30-day APY · daily</span>
        <span>
          {lo.toFixed(1)}% – {hi.toFixed(1)}%
        </span>
      </figcaption>
    </figure>
  );
}

function Simulator({ apy }: { apy: number | null }) {
  const account = useAccount();
  const idle = Math.max(0, Math.round(account.usdg));
  const [amount, setAmount] = useState<number | null>(null);
  useEffect(() => setAmount(null), [idle]);
  const value = amount ?? (idle > 0 ? idle : 10_000);
  const max = Math.max(50_000, Math.ceil(idle / 1000) * 1000);
  const r = (apy ?? 0) / 100;
  const month = value * (Math.pow(1 + r, 30 / 365) - 1);
  const year = value * r;
  return (
    <div className="card panel earn-sim">
      <div className="earn-sim-head">
        <h3>Paper simulator</h3>
        <span className="unit">{idle > 0 ? `Paper wallet idle USDG: ${usd(idle, 0)}` : "No idle USDG in your paper wallet yet"}</span>
      </div>
      <label className="field" htmlFor="earn-amt">
        Amount
      </label>
      <div className="earn-amt">
        <input id="earn-amt" type="range" min={0} max={max} step={100} value={value} onChange={(e) => setAmount(Number(e.target.value))} />
        <b className="mono">{usd(value, 0)}</b>
      </div>
      <div className="earn-proj">
        <div>
          <span className="unit">30 days</span>
          <strong>+{usd(month)}</strong>
        </div>
        <div>
          <span className="unit">1 year</span>
          <strong>+{usd(year)}</strong>
        </div>
      </div>
      <p className="earn-fine">
        Projected at the 7-day APY of {pctFmt(apy)}. Rates change daily; this is an illustration, not a forecast. Borrow USDG in the paper vault to
        see your own idle balance here.
      </p>
    </div>
  );
}

export function Earn() {
  const { data, error } = useApi<SentoraEarn>("/api/earn/sentora", 600_000);
  if (!data) return <div className="skeleton">{error ? "Earn data is unavailable right now." : "Loading…"}</div>;
  const dataAge = data.dataAt ? (Date.now() - Date.parse(data.dataAt)) / 3_600_000 : null;
  const pub = data.apyPublished;
  const headline = pub ? pub.apy : data.apy7d;
  const asOf = pub ? new Date(`${pub.asOf}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "";
  return (
    <div className="earn">
      {data.stale && (
        <div className="earn-warn" role="status">
          Vault data hasn&apos;t refreshed for over an hour. Figures may be out of date.
        </div>
      )}
      <div className="earn-grid">
        <div className="card panel earn-main">
          <div className="earn-vault">
            <img className="earn-logo" src="/logos/sentora.png" alt="Sentora" width={44} height={44} />
            <div className="earn-vault-name">
              <span className="unit">
                {data.vault.chain} · {data.vault.asset} vault
              </span>
              <h3>{data.vault.name}</h3>
            </div>
            {data.coverActive ? (
              <span className="earn-badge" title="Firelight cover protects against specific defined events only, up to set limits.">
                <i aria-hidden="true" /> Firelight cover active
              </span>
            ) : (
              !data.vault.confirmed && <span className="earn-pending">Vault pending confirmation by Sentora</span>
            )}
          </div>

          <div className="earn-apy">
            <strong>{pctFmt(headline, pub ? 1 : 2)}</strong>
            <span className="unit">
              {pub ? `Est. APY · 7-day · as published by Sentora, ${asOf} · variable, not guaranteed` : "Net APY · 7-day · current, variable, not guaranteed"}
            </span>
          </div>

          <div className="earn-stats">
            <div>
              <span className="unit">30-day APY{pub ? " · calc." : ""}</span>
              <b className="mono">{pctFmt(data.apy30d)}</b>
            </div>
            <div>
              <span className="unit">TVL</span>
              <b className="mono">{data.tvl === null ? "—" : compact(data.tvl)}</b>
            </div>
            <div>
              <span className="unit">Share price</span>
              <b className="mono">{data.sharePrice === null ? "—" : `${data.sharePrice.toFixed(5)} ${data.vault.asset}`}</b>
            </div>
          </div>

          <ApySpark points={data.history} />

          <a className="btn earn-cta" href={data.depositUrl} target="_blank" rel="noopener noreferrer">
            Deposit on Sentora <span>↗</span>
          </a>
          <p className="earn-risk">
            Yield shown is the vault&apos;s current variable rate, not a guarantee. The Sentora vault uses leveraged lending strategies on real-world assets,
            which can lose value.{" "}
            {data.coverActive
              ? "Firelight cover protects against specific defined events only, up to set limits, and claims are decided by an independent consortium. "
              : "Firelight cover is not shown for this vault until Sentora confirms it. "}
            Nightshift does not hold your funds and is not affiliated with Sentora unless stated. Not investment advice.
          </p>
          <p className="earn-src mono">
            Source: {data.source === "defillama" ? "DefiLlama share-price history" : "vault contract + DefiLlama history"}
            {pub && data.apy7d !== null && ` · on-chain 7-day calc. ${pctFmt(data.apy7d)}`}
            {dataAge !== null && ` · data ${dataAge < 1 ? "under an hour" : `${Math.round(dataAge)}h`} old`} · refreshed every 10 min
          </p>
        </div>

        <Simulator apy={headline} />
      </div>
    </div>
  );
}
