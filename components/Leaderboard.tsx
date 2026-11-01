"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { EIP1193Provider } from "viem";
import { addrUrl } from "@/lib/chain";
import { joinMessage } from "@/lib/join";
import type { Leaderboard as Board, LeaderRow } from "@/lib/leaderboard";
import { useWallet } from "@/lib/wallet";
import { PageHero, PageShell, SectionHead } from "./Site";
import { toast } from "./Toast";
import { ProfileAvatar } from "./ProfileAvatar";
import { ago } from "./Transactions";
import { usd } from "./useApi";
import { useCountConnect, useRegistered } from "./Member";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const hex = (s: string) => `0x${Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("")}`;
const SEEN = (a: string) => `ns-join-asked:${a.toLowerCase()}`;
const SIGNUP = (a: string) => `ns-signup-later:${a.toLowerCase()}`;
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string) => { try { localStorage.setItem(k, "1"); } catch { /* storage blocked */ } },
};
// "Later" on the sign-up card lasts for this visit only: it asks again next time
const session = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string) => { try { sessionStorage.setItem(k, "1"); } catch { /* storage blocked */ } },
};

/** Signs the join message (free, no transaction) and asks the server to record it on Algorand. */
export async function join(provider: EIP1193Provider, account: string) {
  const issuedAt = new Date().toISOString();
  toast("Sign the message in your wallet. It's free and sends no transaction.");
  const signature = (await provider.request({ method: "personal_sign", params: [hex(joinMessage(account, issuedAt)) as `0x${string}`, account as `0x${string}`] })) as string;
  const res = await fetch("/api/leaderboard/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: account, signature, issuedAt }) });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? "Couldn't join right now.");
  store.set(SEEN(account));
  toast(j.already ? "You're already on the leaderboard." : "You're on the leaderboard, recorded on Algorand.", "ok");
  return j as { tx?: string };
}

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

/**
 * After a wallet connects: counts it as a user, then asks it to finish sign-up (invite code and email) if it hasn't,
 * or, once registered, offers to add it to the Algorand leaderboard (once per address).
 */
export function JoinPrompt() {
  const w = useWallet();
  const path = usePathname();
  useCountConnect();
  const registered = useRegistered(w.account);
  const [show, setShow] = useState<"" | "signup" | "join">("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setShow("");
    if (!w.account || registered === null) return;
    if (!registered) {
      if (!session.get(SIGNUP(w.account))) setShow("signup");
      return;
    }
    if (store.get(SEEN(w.account))) return;
    let alive = true;
    fetch("/api/leaderboard")
      .then((r) => r.json())
      .then((b: Board) => {
        const me = b.rows?.find((r) => r.address === w.account!.toLowerCase());
        if (me?.joined) store.set(SEEN(w.account!));
        else if (alive) setShow("join");
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [w.account, registered]);
  // the profile page does sign-up itself; the leaderboard page has its own Join button
  if (!show || !w.account || path === "/profile" || (show === "join" && path === "/leaderboard")) return null;

  if (show === "signup") {
    const dismiss = () => { session.set(SIGNUP(w.account!)); setShow(""); };
    return (
      <div className="join-prompt" role="dialog" aria-label="Finish signing up">
        <button className="guide-x" onClick={dismiss} aria-label="Not now">×</button>
        <p className="guide-kicker">Welcome</p>
        <p className="join-title">You&apos;re in as {short(w.account)}. Finish your profile to start.</p>
        <p className="join-text">Nightshift is invite-only for now. Enter your invite code, verify your email and pick a username. It takes about a minute.</p>
        <div className="guide-nav">
          <button className="btn secondary small" onClick={dismiss}>Later</button>
          <Link className="btn primary small" href="/profile" onClick={dismiss}>Finish profile</Link>
        </div>
      </div>
    );
  }

  const dismiss = () => { store.set(SEEN(w.account!)); setShow(""); };
  return (
    <div className="join-prompt" role="dialog" aria-label="Join the leaderboard">
      <button className="guide-x" onClick={dismiss} aria-label="Not now">×</button>
      <p className="guide-kicker">Leaderboard</p>
      <p className="join-title">Record {short(w.account)} on Algorand?</p>
      <p className="join-text">Sign a free message (no transaction). Your join is stamped on Algorand TestNet and adds 10 points.</p>
      <div className="guide-nav">
        <button className="btn secondary small" onClick={dismiss}>Not now</button>
        <button
          className="btn primary small"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try { await join(w.provider!, w.account!); setShow(""); }
            catch (e) { toast((e as Error).message?.includes("rejected") ? "Signature cancelled." : (e as Error).message, "warn"); }
            finally { setBusy(false); }
          }}
        >
          {busy ? "Joining…" : "Join"}
        </button>
      </div>
    </div>
  );
}

const BADGES: [keyof LeaderRow, string, string][] = [
  ["registered", "Registered", "Finished sign-up: invite code, verified email and username"],
  ["joined", "Joined", "Signed up, recorded on Algorand"],
  ["borrowing", "Borrower", "Has an open loan in the Vault"],
  ["guardian", "Guardian", "Auto-protection switched on"],
];

export function LeaderboardPage() {
  const { data, load } = useBoard();
  const w = useWallet();
  const [busy, setBusy] = useState(false);
  const me = w.account ? data?.rows.find((r) => r.address === w.account!.toLowerCase()) : undefined;
  const registered = useRegistered(w.account);

  const onJoin = async () => {
    if (!w.account || !w.provider) return toast("Connect a wallet first, with the button at the top.", "warn");
    setBusy(true);
    try { await join(w.provider, w.account); await load(); }
    catch (e) { toast((e as Error).message?.includes("rejected") ? "Signature cancelled." : (e as Error).message, "warn"); }
    finally { setBusy(false); }
  };

  return (
    <PageShell>
      <PageHero
        overline="LEADERBOARD"
        title="Everyone who's tried Nightshift."
        lead="Every wallet that connected, ranked by what it has done. Activity is read from Base and Algorand, so points can't be edited, including by us."
      />
      <section className="block">
        <div className="wrap">
          <div className="lb-stats">
            {[
              ["Users", data?.totals.wallets],
              ["Registered", data?.totals.registered],
              ["Joined", data?.totals.joined],
              ["Deposited", data?.totals.depositors],
              ["Borrowing now", data?.totals.borrowers],
              ["Guardian on", data?.totals.guardians],
            ].map(([k, v]) => (
              <div key={k as string} className="lb-stat">
                <span>{k}</span>
                <b>{v ?? "…"}</b>
              </div>
            ))}
          </div>

          <div className="lb-join">
            {w.account && registered === false ? (
              <>
                <p>
                  <b>{short(w.account)}</b> is counted as a user. Finish your profile (invite code, email, username) to get a username here,
                  +{data?.scoring.registered ?? 15} points, and the wallet tools.
                </p>
                <Link className="btn primary small" href="/profile">Finish profile</Link>
              </>
            ) : me?.joined ? (
              <p>
                <b>You&apos;re #{me.rank}</b> with {me.points} points. <Link href="/profile">Edit your profile</Link> ·{" "}
                {me.joinTx && <a href={me.joinTx} target="_blank" rel="noopener noreferrer">See your join on Algorand ↗</a>}
              </p>
            ) : (
              <>
                <p>
                  {w.account ? <>Add <b>{short(w.account)}</b> to the leaderboard.</> : <>Connect a wallet to join.</>} Joining is a free signature,
                  not a transaction, and puts your address on a public list.
                </p>
                <button className="btn primary small" onClick={onJoin} disabled={busy || !w.account}>
                  {busy ? "Joining…" : "Join the leaderboard"}
                </button>
              </>
            )}
          </div>

          {!data ? (
            <div className="skeleton">Loading the leaderboard…</div>
          ) : data.rows.length === 0 ? (
            <p className="muted">No wallets yet. Be the first to join.</p>
          ) : (
            <div className="lb-table-wrap">
              <table className="lb-table">
                <thead>
                  <tr><th>#</th><th>Wallet</th><th>Points</th><th>Activity</th><th className="num">Collateral</th><th>Since</th></tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.address} className={me?.address === r.address ? "me" : ""}>
                      <td className="lb-rank">{r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : r.rank}</td>
                      <td className="mono">
                        {r.avatarAt && <ProfileAvatar address={r.address} name={r.name} size={26} version={r.avatarAt} className="lb-photo" />}
                        {r.name && <span className="lb-name">{r.name}</span>}
                        {r.username && <span className="lb-user">@{r.username}</span>}
                        <a href={r.service?.chain === "Algorand" ? `https://lora.algokit.io/testnet/account/${r.address}` : addrUrl(r.address)} target="_blank" rel="noopener noreferrer">{short(r.address)}</a>
                        {r.x && <a className="lb-x" href={`https://x.com/${r.x}`} target="_blank" rel="noopener noreferrer">@{r.x}</a>}
                        {me?.address === r.address && <span className="lb-you">you</span>}
                      </td>
                      <td className="mono lb-points">{r.points}</td>
                      <td>
                        <div className="lb-badges">
                          {r.team && <span className="lb-badge" title="A wallet the Nightshift team runs to exercise the live contracts">Team demo wallet</span>}
                          {r.service && <span className="lb-badge" title={r.service.job}>{r.service.job}</span>}
                          {!r.service && !r.registered && <span className="lb-badge muted-badge" title="Connected a wallet, sign-up not finished yet">Connected</span>}
                          {BADGES.filter(([k]) => r[k]).map(([k, label, tip]) => <span key={k} className="lb-badge" title={tip}>{label}</span>)}
                          {r.markets.map((m) => <span key={m} className="lb-badge token" title={`Deposited ${m}`}>{m}</span>)}
                        </div>
                      </td>
                      <td className="mono num">{r.collateralUsd ? usd(r.collateralUsd, 0) : "–"}</td>
                      <td className="small">
                        {r.service ? (
                          <span className="muted">{r.service.lastActive ? ago(r.service.lastActive) : "–"}</span>
                        ) : r.joinedAt ? (
                          <a href={r.joinTx ?? "#"} target="_blank" rel="noopener noreferrer">{new Date(r.joinedAt * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })} ↗</a>
                        ) : r.connectedAt ? (
                          <span className="muted" title="First connected">{new Date(r.connectedAt * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
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

      <section className="block alt">
        <div className="wrap">
          <SectionHead overline="Scoring" title="How points work." />
          <div className="lb-scoring">
            <div className="card"><b>+{data?.scoring.registered ?? 15}</b><p>Finish sign-up: invite code, verified email and a username.</p></div>
            <div className="card"><b>+{data?.scoring.joined ?? 10}</b><p>Record your join on Algorand (a free signature).</p></div>
            <div className="card"><b>+{data?.scoring.perMarket ?? 20}</b><p>For each ETF token you&apos;ve deposited in the Vault.</p></div>
            <div className="card"><b>+{data?.scoring.borrowing ?? 30}</b><p>While you have an open loan.</p></div>
            <div className="card"><b>+{data?.scoring.guardian ?? 25}</b><p>With Guardian auto-protection switched on.</p></div>
          </div>
          <p className="small muted" style={{ marginTop: 14 }}>
            Ties go to more collateral, then to whoever arrived first. Every wallet that connects is listed; finishing sign-up, joining on
            Algorand and using the Vault add points. Points have no value. <Link href="/app">Open the App</Link> to earn them.
          </p>
        </div>
      </section>
    </PageShell>
  );
}
