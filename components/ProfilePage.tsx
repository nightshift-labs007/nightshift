"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { addrUrl } from "@/lib/chain";
import { EMPTY_PROFILE, LIMITS, signInMessage, validateProfile, type Profile } from "@/lib/profile-shared";
import { useWallet } from "@/lib/wallet";
import { join, useBoard } from "./Leaderboard";
import { PageHero, PageShell } from "./Site";
import { toast } from "./Toast";
import { usd } from "./useApi";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const hex = (s: string) => `0x${Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
const cancelled = (e: unknown) => /reject|denied|cancel/i.test(String((e as Error)?.message ?? e));

type Me = { enabled: boolean; signedIn?: boolean; address?: string; profile?: Profile; exists?: boolean; error?: string };

/** A small gradient badge drawn from the address, so every wallet has a recognisable avatar. */
function Avatar({ address, name }: { address: string; name?: string }) {
  const h1 = parseInt(address.slice(2, 8), 16) % 360;
  const h2 = (h1 + 40 + (parseInt(address.slice(8, 12), 16) % 140)) % 360;
  return (
    <span className="pf-avatar" style={{ background: `linear-gradient(135deg, hsl(${h1} 55% 62%), hsl(${h2} 50% 38%))` }} aria-hidden="true">
      {(name || "").trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

function Points({ account }: { account: string }) {
  const { data, load } = useBoard();
  const w = useWallet();
  const [busy, setBusy] = useState(false);
  const row = data?.rows.find((r) => r.address === account.toLowerCase());
  const s = data?.scoring ?? { joined: 10, perMarket: 20, borrowing: 30, guardian: 25 };
  const items = [
    { done: !!row?.joined, label: "Joined the leaderboard", pts: s.joined, action: row?.joined ? null : "join" },
    { done: !!row?.markets.length, label: row?.markets.length ? `Deposited ${row.markets.join(", ")}` : "Deposit an ETF token in the Vault", pts: s.perMarket * Math.max(1, row?.markets.length ?? 0), each: true, href: "/app" },
    { done: !!row?.borrowing, label: "Have an open loan", pts: s.borrowing, href: "/app" },
    { done: !!row?.guardian, label: "Switch on the Guardian", pts: s.guardian, href: "/app#guardian" },
  ];
  return (
    <div className="pf-card pf-points">
      <div className="pf-points-top">
        <div>
          <p className="pf-label">Points</p>
          <p className="pf-big">{data ? row?.points ?? 0 : "…"}</p>
        </div>
        <div>
          <p className="pf-label">Rank</p>
          <p className="pf-big">{data ? (row ? `#${row.rank}` : "–") : "…"}</p>
          {data && <p className="small muted">of {data.totals.wallets}</p>}
        </div>
        <div>
          <p className="pf-label">Collateral</p>
          <p className="pf-big small-num">{row?.collateralUsd ? usd(row.collateralUsd, 0) : "–"}</p>
        </div>
      </div>
      <ul className="pf-checklist">
        {items.map((it) => (
          <li key={it.label} className={it.done ? "done" : ""}>
            <span className="pf-tick" aria-hidden="true">{it.done ? "✓" : ""}</span>
            <span className="pf-item">{it.label}</span>
            <span className="pf-pts">+{it.pts}{it.each && !it.done ? " each" : ""}</span>
            {!it.done && it.action === "join" && (
              <button
                className="btn primary small"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try { await join(w.provider!, account); await load(); }
                  catch (e) { toast(cancelled(e) ? "Signature cancelled." : (e as Error).message, "warn"); }
                  finally { setBusy(false); }
                }}
              >
                {busy ? "Joining…" : "Join"}
              </button>
            )}
            {!it.done && it.href && <Link className="pf-go" href={it.href}>Go →</Link>}
          </li>
        ))}
      </ul>
      <p className="small muted">
        Points come from public chains: joins on Algorand, Vault activity on Base. <Link href="/leaderboard">See the leaderboard →</Link>
      </p>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="pf-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Editor({ account, onName }: { account: string; onName: (n: string) => void }) {
  const w = useWallet();
  const [me, setMe] = useState<Me | null>(null);
  const [form, setForm] = useState<Profile>(EMPTY_PROFILE);
  const [busy, setBusy] = useState<"" | "signin" | "save" | "delete">("");
  const [saved, setSaved] = useState<Profile | null>(null);

  const load = useCallback(async () => {
    const j = (await fetch("/api/profile", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ enabled: false, error: "unreachable" }))) as Me;
    setMe(j);
    if (j.profile) { setForm(j.profile); setSaved(j.profile); onName(j.profile.name); }
  }, [onName]);
  useEffect(() => { load(); }, [load, account]);

  const signedInHere = me?.signedIn && me.address === account.toLowerCase();
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify({ ...form, updatedAt: 0 }) !== JSON.stringify({ ...(saved ?? EMPTY_PROFILE), updatedAt: 0 });

  const signIn = async () => {
    setBusy("signin");
    try {
      const issuedAt = new Date().toISOString();
      toast("Sign the message in your wallet. It's free and sends no transaction.");
      const signature = await w.provider!.request({ method: "personal_sign", params: [hex(signInMessage(account, issuedAt)), account as `0x${string}`] });
      const res = await fetch("/api/profile/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: account, signature, issuedAt }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Sign-in failed.");
      toast("Signed in.", "ok");
      await load();
    } catch (e) {
      toast(cancelled(e) ? "Signature cancelled." : (e as Error).message, "warn");
    } finally {
      setBusy("");
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = validateProfile(form);
    if (!v.ok) return toast(v.error, "warn");
    setBusy("save");
    try {
      const res = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v.profile) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Couldn't save.");
      setForm(j.profile);
      setSaved(j.profile);
      onName(j.profile.name);
      toast("Profile saved.", "ok");
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    if (!window.confirm("Delete your profile? Your name, email and links are removed. Points stay, because they come from public chains.")) return;
    setBusy("delete");
    try {
      const res = await fetch("/api/profile", { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Couldn't delete.");
      setForm(EMPTY_PROFILE);
      setSaved(EMPTY_PROFILE);
      onName("");
      toast("Profile deleted.", "ok");
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setBusy("");
    }
  };

  const signOut = async () => {
    await fetch("/api/profile/session", { method: "DELETE" }).catch(() => {});
    setSaved(null);
    setForm(EMPTY_PROFILE);
    await load();
  };

  if (!me) return <div className="pf-card skeleton">Loading your profile…</div>;
  if (!me.enabled)
    return (
      <div className="pf-card pf-off">
        <p className="pf-label">Profile</p>
        <p>Profiles are being switched on. Your points above already work; editing your name, email and links will open here shortly.</p>
      </div>
    );
  if (!signedInHere)
    return (
      <div className="pf-card pf-signin">
        <p className="pf-label">Profile</p>
        <h3>Sign in to build your profile</h3>
        <p className="muted">Sign a free message with {short(account)} to prove it&apos;s yours. No transaction, no gas. You stay signed in for 7 days on this browser.</p>
        <button className="btn primary" onClick={signIn} disabled={busy === "signin"}>{busy === "signin" ? "Waiting for signature…" : "Sign in with wallet"}</button>
      </div>
    );

  return (
    <form className="pf-card pf-form" onSubmit={save}>
      <div className="pf-form-head">
        <p className="pf-label">Profile</p>
        <button type="button" className="pf-link" onClick={signOut}>Sign out</button>
      </div>
      <div className="pf-grid">
        <Field label="Display name" hint="Shown on the leaderboard if you allow it below.">
          <input value={form.name} maxLength={LIMITS.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Night Owl" autoComplete="nickname" />
        </Field>
        <Field label="Email" hint="Private. Never shown publicly or shared.">
          <input type="email" value={form.email} maxLength={LIMITS.email} onChange={(e) => set("email", e.target.value)} placeholder="you@example.com" autoComplete="email" />
        </Field>
        <Field label="X (Twitter)">
          <div className="pf-prefix"><span>@</span><input value={form.x} onChange={(e) => set("x", e.target.value)} placeholder="handle" maxLength={40} /></div>
        </Field>
        <Field label="Telegram">
          <div className="pf-prefix"><span>@</span><input value={form.telegram} onChange={(e) => set("telegram", e.target.value)} placeholder="username" maxLength={40} /></div>
        </Field>
        <Field label="Website">
          <input value={form.website} maxLength={LIMITS.website} onChange={(e) => set("website", e.target.value)} placeholder="https://…" autoComplete="url" />
        </Field>
        <Field label="Bio" hint={`${form.bio.length}/${LIMITS.bio}`}>
          <textarea value={form.bio} maxLength={LIMITS.bio} rows={2} onChange={(e) => set("bio", e.target.value)} placeholder="A line about you" />
        </Field>
      </div>
      <label className="pf-check">
        <input type="checkbox" checked={form.showPublic} onChange={(e) => set("showPublic", e.target.checked)} />
        <span>Show my name and X handle on the leaderboard. Email, Telegram and website always stay private.</span>
      </label>
      <div className="pf-actions">
        <button type="button" className="pf-link danger" onClick={remove} disabled={busy !== "" || !saved?.updatedAt}>Delete profile</button>
        <span className="small muted">{saved?.updatedAt ? `Saved ${new Date(saved.updatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Not saved yet"}</span>
        <button className="btn primary" type="submit" disabled={busy !== "" || !dirty}>{busy === "save" ? "Saving…" : "Save profile"}</button>
      </div>
    </form>
  );
}

export function ProfilePage() {
  const w = useWallet();
  const { data } = useBoard();
  const row = w.account ? data?.rows.find((r) => r.address === w.account!.toLowerCase()) : undefined;
  const [myName, setMyName] = useState("");
  const name = myName || row?.name;
  return (
    <PageShell>
      <PageHero
        overline="PROFILE"
        title="Your Nightshift profile."
        lead="Add a name and your links, and see the points you've collected. Your wallet is your login: one free signature, no password, no transaction."
      />
      <section className="block">
        <div className="wrap">
          {!w.account ? (
            <div className="pf-card pf-signin">
              <h3>Connect a wallet to start</h3>
              <p className="muted">Use the <b>Connect wallet</b> button at the top. Your profile and points belong to that address.</p>
            </div>
          ) : (
            <>
              <div className="pf-header">
                <Avatar address={w.account} name={name} />
                <div>
                  <h2>{name || short(w.account)}</h2>
                  <p className="mono small">
                    <a href={addrUrl(w.account)} target="_blank" rel="noopener noreferrer">{w.account} ↗</a>
                    {row?.x && <> · <a href={`https://x.com/${row.x}`} target="_blank" rel="noopener noreferrer">@{row.x}</a></>}
                  </p>
                </div>
              </div>
              <div className="pf-layout">
                <Points account={w.account} />
                <Editor account={w.account} onName={setMyName} />
              </div>
            </>
          )}
        </div>
      </section>
    </PageShell>
  );
}
