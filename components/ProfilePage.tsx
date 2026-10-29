"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { addrUrl } from "@/lib/chain";
import { AVATAR, EMPTY_PROFILE, LIMITS, signInMessage, validateProfile, type Profile } from "@/lib/profile-shared";
import { useWallet } from "@/lib/wallet";
import { join, useBoard } from "./Leaderboard";
import { PageShell } from "./Site";
import { toast } from "./Toast";
import { usd } from "./useApi";
import { ProfileAvatar, avatarChanged } from "./ProfileAvatar";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const hex = (s: string) => `0x${Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
const cancelled = (e: unknown) => /reject|denied|cancel/i.test(String((e as Error)?.message ?? e));

type Me = { enabled: boolean; signedIn?: boolean; address?: string; profile?: Profile; exists?: boolean; avatarAt?: number | null; error?: string };

/** Crops a picture to a centred square and shrinks it to a small JPEG, in the browser, before it is uploaded. */
async function toSquareJpeg(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose a picture file.");
  if (file.size > 15 * 1024 * 1024) throw new Error("That picture is over 15 MB. Please choose a smaller one.");
  const bmp = await createImageBitmap(file).catch(() => {
    throw new Error("That picture couldn't be read. Try a JPEG or PNG.");
  });
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR.size;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, AVATAR.size, AVATAR.size);
  bmp.close();
  for (const q of [0.86, 0.72, 0.58]) {
    const url = canvas.toDataURL("image/jpeg", q);
    if ((url.length * 3) / 4 < AVATAR.maxBytes) return url;
  }
  throw new Error("That picture is too detailed to shrink. Try another one.");
}

function Points({ account }: { account: string }) {
  const { data, load } = useBoard();
  const w = useWallet();
  const [busy, setBusy] = useState(false);
  const row = data?.rows.find((r) => r.address === account.toLowerCase());
  const s = data?.scoring ?? { joined: 10, perMarket: 20, borrowing: 30, guardian: 25 };
  const items = [
    { done: !!row?.joined, label: "Join the leaderboard", how: "One free signature, recorded on Algorand.", pts: s.joined, action: row?.joined ? null : "join" },
    { done: !!row?.markets.length, label: row?.markets.length ? `Deposited ${row.markets.join(", ")}` : "Deposit an ETF token", how: "Each token you deposit in the Vault counts.", pts: s.perMarket * Math.max(1, row?.markets.length ?? 0), each: true, href: "/app" },
    { done: !!row?.borrowing, label: "Open a loan", how: "Borrow dUSDG against your deposit.", pts: s.borrowing, href: "/app" },
    { done: !!row?.guardian, label: "Switch on the Guardian", how: "Auto-protection for your loan.", pts: s.guardian, href: "/app#guardian" },
  ];
  const doneCount = items.filter((i) => i.done).length;
  return (
    <div className="pf-card pf-earn">
      <div className="pf-earn-head">
        <div>
          <p className="pf-label">Earn points</p>
          <h3>{doneCount === items.length ? "Every badge earned" : `${doneCount} of ${items.length} done`}</h3>
        </div>
        <span className="pf-earn-pts mono">{data ? row?.points ?? 0 : "…"} pts</span>
      </div>
      <div className="pf-progress" aria-label={`${doneCount} of ${items.length} steps done`}>
        <i style={{ width: `${(doneCount / items.length) * 100}%` }} />
      </div>
      <ul className="pf-checklist">
        {items.map((it) => (
          <li key={it.label} className={it.done ? "done" : ""}>
            <span className="pf-tick" aria-hidden="true">{it.done ? "✓" : ""}</span>
            <span className="pf-item">
              <b>{it.label}</b>
              <small>{it.how}</small>
            </span>
            <span className="pf-side">
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
            </span>
          </li>
        ))}
      </ul>
      <p className="small muted pf-earn-foot">
        Points come from public chains: joins on Algorand, Vault activity on Base. <Link href="/leaderboard">See the leaderboard →</Link>
      </p>
    </div>
  );
}

/** The profile's header: a cover in the wallet's own colours, the photo, name, links and the headline numbers. */
function Identity({ account, name }: { account: string; name?: string }) {
  const { data } = useBoard();
  const row = data?.rows.find((r) => r.address === account.toLowerCase());
  const [copied, setCopied] = useState(false);
  const h1 = parseInt(account.slice(2, 8), 16) % 360;
  const h2 = (h1 + 40 + (parseInt(account.slice(8, 12), 16) % 140)) % 360;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(account);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Couldn't copy. Select the address instead.", "warn");
    }
  };
  const stats: [string, React.ReactNode][] = [
    ["Points", data ? row?.points ?? 0 : "…"],
    ["Rank", data ? (row ? <>#{row.rank}<small> of {data.rows.length}</small></> : "–") : "…"],
    ["Collateral", row?.collateralUsd ? usd(row.collateralUsd, 0) : "–"],
    ["Badges", data ? [row?.joined, row?.markets.length, row?.borrowing, row?.guardian].filter(Boolean).length + " / 4" : "…"],
  ];
  return (
    <section className="pf-hero">
      <div className="pf-cover" style={{ background: `radial-gradient(120% 140% at 0% 0%, hsl(${h1} 60% 42% / .55), transparent 55%), radial-gradient(120% 140% at 100% 100%, hsl(${h2} 55% 35% / .5), transparent 60%), var(--surface)` }} aria-hidden="true" />
      <div className="pf-id">
        <ProfileAvatar address={account} name={name} size={116} className="pf-id-avatar" />
        <div className="pf-id-text">
          <p className="pf-label">Your profile</p>
          <h1>{name || "Unnamed wallet"}</h1>
          <div className="pf-chips">
            <button className="pf-chip mono" onClick={copy} title="Copy address">
              {short(account)} <span aria-hidden="true">{copied ? "✓" : "⧉"}</span>
            </button>
            <a className="pf-chip" href={addrUrl(account)} target="_blank" rel="noopener noreferrer">Explorer ↗</a>
            {row?.x && <a className="pf-chip" href={`https://x.com/${row.x}`} target="_blank" rel="noopener noreferrer">@{row.x}</a>}
            {row?.joinedAt && <span className="pf-chip">Joined {new Date(row.joinedAt * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>}
          </div>
        </div>
        <Link className="btn secondary small pf-id-cta" href="/leaderboard">View leaderboard</Link>
      </div>
      <div className="pf-stats">
        {stats.map(([k, v]) => (
          <div key={k} className="pf-stat">
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>
    </section>
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
  const [busy, setBusy] = useState<"" | "signin" | "save" | "delete" | "photo">("");
  const [saved, setSaved] = useState<Profile | null>(null);

  const load = useCallback(async () => {
    const j = (await fetch("/api/profile", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ enabled: false, error: "unreachable" }))) as Me;
    setMe(j);
    if (j.profile) { setForm(j.profile); setSaved(j.profile); onName(j.profile.name); }
    if (j.signedIn && j.address) avatarChanged(j.address, j.avatarAt ?? null);
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
    if (!window.confirm("Delete your profile? Your name, photo, email and links are removed. Points stay, because they come from public chains.")) return;
    setBusy("delete");
    try {
      const res = await fetch("/api/profile", { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Couldn't delete.");
      setForm(EMPTY_PROFILE);
      setSaved(EMPTY_PROFILE);
      onName("");
      avatarChanged(account, null);
      toast("Profile deleted.", "ok");
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setBusy("");
    }
  };

  const uploadPhoto = async (file: File | undefined) => {
    if (!file) return;
    setBusy("photo");
    try {
      const image = await toSquareJpeg(file);
      const res = await fetch("/api/profile/avatar", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Couldn't upload the photo.");
      avatarChanged(account, j.avatarAt);
      setMe((m) => (m ? { ...m, avatarAt: j.avatarAt } : m));
      toast("Photo updated.", "ok");
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setBusy("");
    }
  };

  const removePhoto = async () => {
    setBusy("photo");
    try {
      const res = await fetch("/api/profile/avatar", { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Couldn't remove the photo.");
      avatarChanged(account, null);
      setMe((m) => (m ? { ...m, avatarAt: null } : m));
      toast("Photo removed.", "ok");
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
      <div className="pf-photo-row">
        <ProfileAvatar address={account} name={form.name} size={72} version={me.avatarAt ?? null} />
        <div>
          <p className="pf-photo-title">Profile photo</p>
          <p className="small muted">Square photos look best. It&apos;s cropped and shrunk in your browser before upload, and shown on the leaderboard only if your profile is public.</p>
          <div className="pf-photo-actions">
            <label className={`btn secondary small ${busy === "photo" ? "disabled" : ""}`}>
              {busy === "photo" ? "Uploading…" : me.avatarAt ? "Change photo" : "Upload photo"}
              <input type="file" accept="image/*" hidden disabled={busy === "photo"} onChange={(e) => { uploadPhoto(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            {me.avatarAt ? <button type="button" className="pf-link" onClick={removePhoto} disabled={busy === "photo"}>Remove photo</button> : null}
          </div>
        </div>
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
        <span>Show my name, photo and X handle on the leaderboard. Email, Telegram and website always stay private.</span>
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
  if (!w.account)
    return (
      <PageShell>
        <section className="block pf-page">
          <div className="wrap">
            <div className="pf-card pf-connect">
              <span className="pf-connect-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-6 8-6s8 2 8 6" /></svg>
              </span>
              <p className="pf-label">Profile</p>
              <h1>Your Nightshift profile</h1>
              <p className="muted">Add a name, a photo and your links, and see the points you&apos;ve collected. Your wallet is your login: one free signature, no password, no transaction.</p>
              <p className="small muted">Connect a wallet with the <b>Connect wallet</b> button at the top to start.</p>
            </div>
          </div>
        </section>
      </PageShell>
    );
  return (
    <PageShell>
      <section className="block pf-page">
        <div className="wrap">
          <Identity account={w.account} name={name} />
          <div className="pf-layout">
            <Editor account={w.account} onName={setMyName} />
            <Points account={w.account} />
          </div>
        </div>
      </section>
    </PageShell>
  );
}
