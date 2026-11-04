"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { addrUrl } from "@/lib/chain";
import type { Leaderboard as Board, LeaderRow } from "@/lib/leaderboard";
import { useWallet } from "@/lib/wallet";
import { PageHero, PageShell } from "./Site";
import { ProfileAvatar } from "./ProfileAvatar";
import { ago } from "./Transactions";
import { usd } from "./useApi";
import { useCountConnect, useRegistered } from "./Member";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const SIGNUP = (a: string) => `ns-signup-later:${a.toLowerCase()}`;
// "Later" on the sign-up card lasts for this visit only: it asks again next time
const session = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string) => { try { sessionStorage.setItem(k, "1"); } catch { /* storage blocked */ } },
};

export function useBoard() {
  const [data, setData] = useState<Board | null>(null);
  const load = useCallback(async () => {
    const res = await fetch("/api/leaderboard", { cache: "no-store" }).catch(() => null);
    const j = await res?.json().catch(() => null);
    if (j && !j.error) setData(j);
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);
  return { data, load };
}

/** After a wallet connects: counts it as a user and, until it has signed up, asks it to (once per visit). */
export function JoinPrompt() {
  const w = useWallet();
  const path = usePathname();
  useCountConnect();
  const registered = useRegistered(w.account);
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(!!w.account && registered === false && !session.get(SIGNUP(w.account)));
  }, [w.account, registered]);
  // the profile page is the sign-up itself
  if (!show || !w.account || path === "/profile") return null;
  const dismiss = () => { session.set(SIGNUP(w.account!)); setShow(false); };
  return (
    <div className="join-prompt" role="dialog" aria-label="Sign up">
      <button className="guide-x" onClick={dismiss} aria-label="Not now">×</button>
      <p className="guide-kicker">Welcome</p>
      <p className="join-title">Sign up to start with {short(w.account)}.</p>
      <p className="join-text">Nightshift is invite-only for now: your invite code, your email and a username. No signatures, about a minute.</p>
      <div className="guide-nav">
        <button className="btn secondary small" onClick={dismiss}>Later</button>
        <Link className="btn primary small" href="/profile" onClick={dismiss}>Sign up</Link>
      </div>
    </div>
  );
}

const BADGES: [keyof LeaderRow, string, string][] = [
  ["registered", "Member", "Signed up: invite code, verified email and username"],
  ["borrowing", "Borrower", "Has an open loan in the Vault"],
  ["guardian", "Guardian", "Auto-protection switched on"],
];

export function LeaderboardPage() {
  const { data } = useBoard();
  const w = useWallet();
  const me = w.account ? data?.rows.find((r) => r.address === w.account!.toLowerCase()) : undefined;
  const registered = useRegistered(w.account);
  const day = (t: number) => new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <PageShell>
      <PageHero
        overline="LEADERBOARD"
        title="Everyone who's on Nightshift."
        lead="Members in the order they signed up, then everyone who has connected a wallet. Sign-ups are recorded on Algorand and activity is read from Base, so the list can't be edited, including by us."
      />
      <section className="block">
        <div className="wrap">
          <div className="lb-stats">
            {[
              ["Members", data?.totals.registered],
              ["Wallets", data?.totals.wallets],
              ["Deposited", data?.totals.depositors],
              ["Borrowing now", data?.totals.borrowers],
            ].map(([k, v]) => (
              <div key={k as string} className="lb-stat">
                <span>{k}</span>
                <b>{v ?? "…"}</b>
              </div>
            ))}
          </div>

          <div className="lb-join">
            {!w.account ? (
              <p>Connect a wallet with the button at the top, then sign up with your invite code and email to join.</p>
            ) : registered === false ? (
              <>
                <p>
                  <b>{short(w.account)}</b> is connected. Sign up with your invite code and email to join the leaderboard. No signatures, about a
                  minute.
                </p>
                <Link className="btn primary small" href="/profile">Sign up</Link>
              </>
            ) : me?.registered ? (
              <p>
                <b>You&apos;re member #{me.rank}.</b> <Link href="/profile">Edit your profile</Link>
                {me.joinTx && <> · <a href={me.joinTx} target="_blank" rel="noopener noreferrer">Your sign-up on Algorand ↗</a></>}
              </p>
            ) : (
              <p>Loading your place…</p>
            )}
          </div>

          {!data ? (
            <div className="skeleton">Loading the leaderboard…</div>
          ) : data.rows.length === 0 ? (
            <p className="muted">No one yet. Be the first to sign up.</p>
          ) : (
            <div className="lb-table-wrap">
              <table className="lb-table">
                <thead>
                  <tr><th>#</th><th>Member</th><th>Activity</th><th className="num">Collateral</th><th>Since</th></tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.address} className={me?.address === r.address ? "me" : ""}>
                      <td className="lb-rank">{r.rank}</td>
                      <td className="mono">
                        {r.avatarAt && <ProfileAvatar address={r.address} name={r.name} size={26} version={r.avatarAt} className="lb-photo" />}
                        {r.name && <span className="lb-name">{r.name}</span>}
                        {r.username && <span className="lb-user">@{r.username}</span>}
                        <a href={r.service?.chain === "Algorand" ? `https://lora.algokit.io/testnet/account/${r.address}` : addrUrl(r.address)} target="_blank" rel="noopener noreferrer">{short(r.address)}</a>
                        {r.x && <a className="lb-x" href={`https://x.com/${r.x}`} target="_blank" rel="noopener noreferrer">@{r.x}</a>}
                        {me?.address === r.address && <span className="lb-you">you</span>}
                      </td>
                      <td>
                        <div className="lb-badges">
                          {r.team && <span className="lb-badge" title="A wallet the Nightshift team runs to exercise the live contracts">Team demo wallet</span>}
                          {r.service && <span className="lb-badge" title={`${r.service.actions} transactions`}>{r.service.job}</span>}
                          {!r.service && !r.registered && <span className="lb-badge muted-badge" title="Connected a wallet, not signed up yet">Connected</span>}
                          {BADGES.filter(([k]) => r[k]).map(([k, label, tip]) => <span key={k} className="lb-badge" title={tip}>{label}</span>)}
                          {r.markets.map((m) => <span key={m} className="lb-badge token" title={`Deposited ${m}`}>{m}</span>)}
                        </div>
                      </td>
                      <td className="mono num">{r.collateralUsd ? usd(r.collateralUsd, 0) : "–"}</td>
                      <td className="small">
                        {r.service ? (
                          <span className="muted">{r.service.lastActive ? ago(r.service.lastActive) : "–"}</span>
                        ) : r.registeredAt ? (
                          r.joinTx ? <a href={r.joinTx} target="_blank" rel="noopener noreferrer">{day(r.registeredAt)} ↗</a> : <span>{day(r.registeredAt)}</span>
                        ) : r.connectedAt ? (
                          <span className="muted" title="First connected">{day(r.connectedAt)}</span>
                        ) : r.joinedAt ? (
                          <span className="muted">{day(r.joinedAt)}</span>
                        ) : <span className="muted">on-chain only</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data && (data.sources.joins !== "ok" || data.sources.vault !== "ok" || data.sources.members !== "ok") && (
            <p className="small muted">
              Some data is temporarily unavailable ({data.sources.joins !== "ok" ? "Algorand joins" : data.sources.vault !== "ok" ? "Vault positions" : "sign-ups"}); it will fill in on the next refresh.
            </p>
          )}
        </div>
      </section>
    </PageShell>
  );
}
