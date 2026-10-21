"use client";

import { useMemo, useState } from "react";
import { isTeamWallet } from "@/lib/team-wallets";
import type { Transactions, TxKind, TxRow } from "@/lib/transactions";
import { PageHero, PageShell } from "./Site";
import { useApi } from "./useApi";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const NAMES = { updater: "Oracle Updater", keeper: "Guardian Keeper", faucet: "Faucet", ledger: "Ledger" } as const;

const FILTERS: [string, string, TxKind[] | null][] = [
  ["all", "All", null],
  ["vault", "Vault", ["deposit", "borrow", "repay", "withdraw", "rule", "liquidation"]],
  ["guardian", "Guardian", ["protect"]],
  ["oracle", "Oracle", ["price"]],
  ["cloak", "Cloak", ["attest"]],
  ["algorand", "Algorand", ["prediction", "join"]],
  ["faucet", "Faucet", ["faucet"]],
];

export function ago(unix: number, now = Date.now()) {
  const s = Math.max(0, Math.round(now / 1000 - unix));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Row({ r }: { r: TxRow }) {
  return (
    <tr>
      <td className="small" title={new Date(r.at * 1000).toLocaleString()}>{ago(r.at)}</td>
      <td><span className="lb-badge">{r.title}</span></td>
      <td className="tx-detail">{r.detail}</td>
      <td className="mono">
        {r.actor && isTeamWallet(r.actor) && <span className="lb-badge" title="A wallet the Nightshift team runs to exercise the live contracts">Team</span>}{" "}
        {r.actor ? (
          r.actorUrl ? <a href={r.actorUrl} target="_blank" rel="noopener noreferrer">{r.bot ? NAMES[r.bot] : short(r.actor)}</a> : short(r.actor)
        ) : "–"}
      </td>
      <td className="small">{r.chain}</td>
      <td className="mono small"><a href={r.href} target="_blank" rel="noopener noreferrer">{short(r.id)} ↗</a></td>
    </tr>
  );
}

export function TransactionsPage() {
  const { data } = useApi<Transactions & { error?: string }>("/api/transactions", 60_000);
  const [filter, setFilter] = useState("all");
  const rows = useMemo(() => {
    const kinds = FILTERS.find(([k]) => k === filter)?.[2];
    return (data?.rows ?? []).filter((r) => (!kinds || kinds.includes(r.kind)));
  }, [data, filter]);

  return (
    <PageShell>
      <PageHero
        overline="TRANSACTIONS"
        title="Every transaction, in one place."
        lead="Loans, Guardian saves, Oracle price updates and proofs on Base, plus prediction stamps and sign-ups on Algorand. Each row is read from a public chain and links to its explorer, so nothing on this page can be edited or hidden by us."
      />
      <section className="block">
        <div className="wrap">
          <div className="tx-filters" role="tablist" aria-label="Filter transactions">
            {FILTERS.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={filter === k} className={`btn small ${filter === k ? "primary" : "secondary"}`} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </div>
          {!data ? (
            <div className="skeleton">Reading Base and Algorand…</div>
          ) : data.error ? (
            <p className="muted">Couldn&apos;t load transactions right now. Try again in a minute.</p>
          ) : rows.length === 0 ? (
            <p className="muted">No transactions match.</p>
          ) : (
            <div className="lb-table-wrap">
              <table className="lb-table">
                <thead>
                  <tr><th>When</th><th>Type</th><th>Details</th><th>From</th><th>Chain</th><th>Tx</th></tr>
                </thead>
                <tbody>{rows.map((r) => <Row key={`${r.chain}:${r.id}:${r.kind}:${r.detail}`} r={r} />)}</tbody>
              </table>
            </div>
          )}
          {data && (data.sources.base !== "ok" || data.sources.algorand !== "ok") && (
            <p className="small muted">{data.sources.base !== "ok" ? "Base" : "Algorand"} data is temporarily unavailable; it will fill in on the next refresh.</p>
          )}
          <p className="small muted" style={{ marginTop: 14 }}>
            Showing the latest {data?.rows.length ?? "…"} transactions, newest first.{data?.baseSince && <> Base history starts {new Date(data.baseSince * 1000).toLocaleString()}, as far back as the public node can see; Algorand goes back to the start.</>} Demo assets only.
          </p>
        </div>
      </section>
    </PageShell>
  );
}

const FLOWS: [TxKind, string, string][] = [
  ["deposit", "Deposits", "Collateral locked in the Vault"],
  ["borrow", "Borrows", "USDG borrowed against it"],
  ["repay", "Repayments", "Loans paid back"],
  ["withdraw", "Withdrawals", "Collateral taken back out"],
  ["rule", "Guardian rules", "Auto-protection switched on"],
  ["protect", "Guardian saves", "Loans the Guardian rescued"],
  ["price", "Oracle updates", "Fair values pushed on-chain"],
  ["attest", "Cloak proofs", "Solvency proofs attested on-chain"],
  ["faucet", "Faucet drips", "Demo tokens minted"],
  ["prediction", "Predictions locked", "Pre-open values stamped on Algorand"],
  ["join", "Leaderboard joins", "Sign-ups recorded on Algorand"],
];

/** Counts and the latest explorer link for each kind of transaction: the on-chain footprint of every flow. */
export function ActivityProof() {
  const { data } = useApi<Transactions & { error?: string }>("/api/transactions", 60_000);
  if (!data) return <div className="skeleton">Reading Base and Algorand…</div>;
  if (data.error) return <p className="muted">Couldn&apos;t load the activity right now.</p>;
  return (
    <>
      <div className="lb-stats">
        {FLOWS.map(([k, label, what]) => {
          const f = data.flows[k];
          return (
            <div key={k} className="lb-stat" title={what}>
              <span>{label}</span>
              <b>{f?.count ?? 0}</b>
              {f ? (
                <a className="small mono" href={f.latest.href} target="_blank" rel="noopener noreferrer">latest · {ago(f.latest.at)} ↗</a>
              ) : (
                <span className="small muted">none yet</span>
              )}
            </div>
          );
        })}
      </div>
      <p className="small muted">
        Counted straight from Base and Algorand{data.baseSince ? <>, from {new Date(data.baseSince * 1000).toLocaleString()} on Base (as far back as the public node can see) and since the start on Algorand</> : null}.
        Some of this is the team exercising the live contracts from labelled demo wallets. <a href="/transactions">See every transaction →</a>
      </p>
    </>
  );
}
