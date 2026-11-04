"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { addrUrl } from "@/lib/chain";
import { AVATAR, EMPTY_PROFILE, LIMITS, USERNAME, validateProfile, type Membership, type Profile } from "@/lib/profile-shared";
import { useWallet } from "@/lib/wallet";
import { useBoard } from "./Leaderboard";
import { PageShell } from "./Site";
import { toast } from "./Toast";
import { usd } from "./useApi";
import { ProfileAvatar, avatarChanged } from "./ProfileAvatar";
import { ProfileMarket } from "./Markets";
import { SIGNUP_STEPS, memberChanged, useRegistered } from "./Member";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

type Me = {
  enabled: boolean;
  signedIn?: boolean;
  address?: string;
  profile?: Profile;
  exists?: boolean;
  avatarAt?: number | null;
  member?: Membership;
  emailEnabled?: boolean;
  error?: string;
};

const post = async (url: string, body: unknown) => {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? "Something went wrong. Please try again.");
  return j;
};

/** Sign-up progress: invite code → email → username. */
function Steps({ at }: { at: number }) {
  return (
    <ol className="su-steps" aria-label="Sign-up steps">
      {SIGNUP_STEPS.map((label, i) => (
        <li key={label} className={i < at ? "done" : i === at ? "on" : ""} aria-current={i === at ? "step" : undefined}>
          <span className="su-dot">{i < at ? "✓" : i + 1}</span>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Sign-up and sign-in in one card, with no wallet signature: a new wallet enters its invite code and email, a member
 * enters their email; both get a 6-digit code, and the right code signs the wallet in (7 days on this browser).
 */
function SignUp({ account, member, onDone }: { account: string; member: boolean; onDone: () => void }) {
  const [invite, setInvite] = useState("");
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"" | "send" | "verify">("");
  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy("send");
    try {
      await post("/api/profile/email", { address: account, email, ...(member ? {} : { invite }) });
      setSentTo(email.trim().toLowerCase());
      setCode("");
      toast("Code sent. Check your inbox (and spam).", "ok");
    } catch (err) {
      toast((err as Error).message, "warn");
    } finally {
      setBusy("");
    }
  };
  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("verify");
    try {
      await post("/api/profile/email/verify", { address: account, code });
      toast(member ? "Signed in." : "Email verified. Last step: pick a username.", "ok");
      onDone();
    } catch (err) {
      toast((err as Error).message, "warn");
    } finally {
      setBusy("");
    }
  };
  if (sentTo)
    return (
      <form className="su-step" onSubmit={verify}>
        <h3>Enter the 6-digit code</h3>
        <p className="muted">We sent it to <b>{sentTo}</b>. It expires in 10 minutes.</p>
        <div className="su-row">
          <input
            className="mono su-otp"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            autoFocus
          />
          <button className="btn primary" disabled={busy !== "" || code.length !== 6}>{busy === "verify" ? "Checking…" : member ? "Sign in" : "Verify"}</button>
        </div>
        <p className="small muted">
          Didn&apos;t get it?{" "}
          <button type="button" className="pf-link" onClick={() => send()} disabled={busy !== ""}>Send again</button> ·{" "}
          <button type="button" className="pf-link" onClick={() => setSentTo("")}>Change {member ? "email" : "details"}</button>
        </p>
      </form>
    );
  return (
    <form className="su-step" onSubmit={send}>
      <h3>{member ? "Welcome back. Sign in with your email" : "Sign up"}</h3>
      <p className="muted">
        {member
          ? <>{short(account)} is a member. We&apos;ll email a 6-digit code to the address you signed up with.</>
          : <>Nightshift is invite-only for now. Enter your invite code (it looks like <span className="mono">NS-XXXX-XXXX</span>) and your email; we&apos;ll send a 6-digit code. No wallet signature needed.</>}
      </p>
      {!member && (
        <input className="mono su-code" value={invite} onChange={(e) => setInvite(e.target.value.toUpperCase())} placeholder="NS-XXXX-XXXX" maxLength={14} autoComplete="off" spellCheck={false} autoFocus aria-label="Invite code" />
      )}
      <div className="su-row">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com" maxLength={LIMITS.email} autoComplete="email" aria-label="Email" autoFocus={member} />
        <button className="btn primary" disabled={busy !== "" || !email.includes("@") || (!member && invite.replace(/[^A-Za-z0-9]/g, "").length < 8)}>
          {busy === "send" ? "Sending…" : "Send code"}
        </button>
      </div>
      {!member && <p className="small muted">No code yet? Ask the Nightshift team or a friend who&apos;s already in. Your email stays private.</p>}
    </form>
  );
}

function EmailStep({ current, enabled, onDone, onCancel }: { current?: string | null; enabled: boolean; onDone: () => void; onCancel?: () => void }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"" | "send" | "verify">("");
  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy("send");
    try {
      await post("/api/profile/email", { email });
      setSentTo(email.trim().toLowerCase());
      setCode("");
      toast("Code sent. Check your inbox (and spam).", "ok");
    } catch (err) {
      toast((err as Error).message, "warn");
    } finally {
      setBusy("");
    }
  };
  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("verify");
    try {
      await post("/api/profile/email/verify", { code });
      toast("Email verified.", "ok");
      onDone();
    } catch (err) {
      toast((err as Error).message, "warn");
    } finally {
      setBusy("");
    }
  };
  if (!enabled)
    return (
      <div className="su-step">
        <h3>Verify your email</h3>
        <p className="muted">Email verification is being switched on. Please check back shortly.</p>
      </div>
    );
  if (sentTo)
    return (
      <form className="su-step" onSubmit={verify}>
        <h3>Enter the 6-digit code</h3>
        <p className="muted">We sent it to <b>{sentTo}</b>. It expires in 10 minutes.</p>
        <div className="su-row">
          <input
            className="mono su-otp"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            autoFocus
          />
          <button className="btn primary" disabled={busy !== "" || code.length !== 6}>{busy === "verify" ? "Checking…" : "Verify"}</button>
        </div>
        <p className="small muted">
          Didn&apos;t get it?{" "}
          <button type="button" className="pf-link" onClick={() => send()} disabled={busy !== ""}>Send again</button> ·{" "}
          <button type="button" className="pf-link" onClick={() => setSentTo("")}>Use a different email</button>
        </p>
      </form>
    );
  return (
    <form className="su-step" onSubmit={send}>
      <h3>{current ? "Change your email" : "Verify your email"}</h3>
      <p className="muted">We&apos;ll email you a 6-digit code. Your email stays private: it&apos;s never shown or shared.</p>
      <div className="su-row">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com" maxLength={LIMITS.email} autoComplete="email" autoFocus />
        <button className="btn primary" disabled={busy !== "" || !email.includes("@")}>{busy === "send" ? "Sending…" : "Send code"}</button>
      </div>
      {onCancel && <button type="button" className="pf-link" onClick={onCancel}>Keep {current}</button>}
    </form>
  );
}

/**
 * Nightshift wallet (email login through Privy): Privy has already verified the email, so the server signs the wallet in
 * from the Privy login itself. A new member only adds their invite code.
 */
function WalletSignUp({ onDone }: { onDone: () => void }) {
  const w = useWallet();
  const [state, setState] = useState<"checking" | "invite" | "error">("checking");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const go = useCallback(
    async (code?: string) => {
      setBusy(true);
      try {
        const token = await w.privyToken();
        if (!token) throw new Error("Your login has expired. Log in with your email again.");
        const res = await fetch("/api/profile/privy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, invite: code }) });
        const j = await res.json().catch(() => ({}));
        if (res.ok) {
          if (code) toast("Invite code accepted.", "ok");
          onDone();
        } else if (j.needInvite) setState("invite");
        else {
          if (code || state !== "checking") toast(j.error ?? "Couldn't sign you in. Please try again.", "warn");
          setState(code ? "invite" : "error");
        }
      } catch (e) {
        toast((e as Error).message, "warn");
        setState("error");
      } finally {
        setBusy(false);
      }
    },
    [w, onDone, state],
  );
  useEffect(() => {
    go();
    // once, when the card opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (state === "checking") return <p className="muted">Signing you in with your Nightshift wallet…</p>;
  if (state === "error")
    return (
      <div className="su-step">
        <p className="muted">We couldn&apos;t sign you in just now.</p>
        <button className="btn primary" onClick={() => go()} disabled={busy}>{busy ? "Trying…" : "Try again"}</button>
      </div>
    );
  return (
    <form className="su-step" onSubmit={(e) => { e.preventDefault(); go(invite); }}>
      <h3>Enter your invite code</h3>
      <p className="muted">Your email is verified and your Nightshift wallet is ready. Nightshift is invite-only for now: your code looks like <span className="mono">NS-XXXX-XXXX</span>.</p>
      <div className="su-row">
        <input className="mono su-code" value={invite} onChange={(e) => setInvite(e.target.value.toUpperCase())} placeholder="NS-XXXX-XXXX" maxLength={14} autoComplete="off" spellCheck={false} autoFocus aria-label="Invite code" />
        <button className="btn primary" disabled={busy || invite.replace(/[^A-Za-z0-9]/g, "").length < 8}>{busy ? "Checking…" : "Continue"}</button>
      </div>
    </form>
  );
}

/** Live check that a username is still free (debounced). */
function useUsernameFree(username: string, account: string, saved?: string) {
  const [state, setState] = useState<"" | "checking" | "free" | "taken" | "invalid">("");
  useEffect(() => {
    if (!username || username === saved) return setState("");
    if (!USERNAME.test(username)) return setState("invalid");
    setState("checking");
    const t = setTimeout(() => {
      fetch(`/api/member?username=${encodeURIComponent(username)}&for=${account}`)
        .then((r) => r.json())
        .then((j: { available?: boolean }) => setState(j.available ? "free" : "taken"))
        .catch(() => setState(""));
    }, 400);
    return () => clearTimeout(t);
  }, [username, account, saved]);
  return state;
}

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
    ["Status", data ? (row?.registered ? <>Member #{row.rank}</> : "Not signed up") : "…"],
    ["Member since", row?.registeredAt ? new Date(row.registeredAt * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "–"],
    ["Collateral", row?.collateralUsd ? usd(row.collateralUsd, 0) : "–"],
    ["Loan", row ? (row.borrowing ? "Open" : "None") : "…"],
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
            {row?.username && <span className="pf-chip">@{row.username}</span>}
            {row?.x && <a className="pf-chip" href={`https://x.com/${row.x}`} target="_blank" rel="noopener noreferrer">@{row.x}</a>}
            {row?.joinTx && <a className="pf-chip" href={row.joinTx} target="_blank" rel="noopener noreferrer">Sign-up on Base ↗</a>}
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
  const [busy, setBusy] = useState<"" | "save" | "delete" | "photo">("");
  const registered = useRegistered(account);
  const [saved, setSaved] = useState<Profile | null>(null);
  const [changingEmail, setChangingEmail] = useState(false);

  const load = useCallback(async () => {
    const j = (await fetch("/api/profile", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ enabled: false, error: "unreachable" }))) as Me;
    setMe(j);
    if (j.profile) { setForm(j.profile); setSaved(j.profile); onName(j.profile.name); }
    if (j.signedIn && j.address) avatarChanged(j.address, j.avatarAt ?? null);
  }, [onName]);
  useEffect(() => { load(); }, [load, account]);

  const signedInHere = me?.signedIn && me.address === account.toLowerCase();
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setForm((f) => ({ ...f, [k]: v }));
  const nameState = useUsernameFree(form.username, account, saved?.username);
  const dirty = JSON.stringify({ ...form, updatedAt: 0 }) !== JSON.stringify({ ...(saved ?? EMPTY_PROFILE), updatedAt: 0 });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = validateProfile(form);
    if (!v.ok) return toast(v.error, "warn");
    setBusy("save");
    try {
      const res = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v.profile) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Couldn't save.");
      const first = !me?.member?.registered;
      setForm(j.profile);
      setSaved(j.profile);
      onName(j.profile.name);
      if (j.member) setMe((m) => (m ? { ...m, member: j.member } : m));
      if (first) memberChanged();
      toast(first ? "You're in. Welcome to Nightshift!" : "Profile saved.", "ok");
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    if (!window.confirm("Delete your profile? Your username, name, photo, email and links are removed, and you'll need to verify your email again to come back. Your invite code stays used. On-chain activity stays, because it lives on public chains.")) return;
    setBusy("delete");
    try {
      const res = await fetch("/api/profile", { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Couldn't delete.");
      onName("");
      avatarChanged(account, null);
      memberChanged();
      await load();
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
        <p>Profiles are being switched on. Sign-up will open here shortly.</p>
      </div>
    );
  if (!signedInHere)
    return (
      <div className="pf-card pf-signup">
        <div className="pf-form-head">
          <p className="pf-label">{registered ? "Sign in" : "Sign up"}</p>
        </div>
        {!registered && <Steps at={0} />}
        {w.embedded ? <WalletSignUp onDone={load} /> : registered === null ? <p className="muted">Checking your wallet…</p> : <SignUp account={account} member={!!registered} onDone={load} />}
      </div>
    );

  const member = me.member ?? { invite: false, email: null, registered: false, registeredAt: null };
  const step = !member.invite ? 0 : !member.email ? 1 : 2;
  if (step < 2 || changingEmail)
    return (
      <div className="pf-card pf-signup">
        <div className="pf-form-head">
          <p className="pf-label">{changingEmail ? "Change email" : "Finish sign-up"}</p>
          <button type="button" className="pf-link" onClick={signOut}>Sign out</button>
        </div>
        {!changingEmail && <Steps at={step} />}
        {step === 0 ? (
          <SignUp account={account} member={false} onDone={load} />
        ) : (
          <EmailStep
            enabled={!!me.emailEnabled}
            current={changingEmail ? member.email : null}
            onCancel={changingEmail ? () => setChangingEmail(false) : undefined}
            onDone={async () => {
              setChangingEmail(false);
              await load();
            }}
          />
        )}
      </div>
    );

  return (
    <form className="pf-card pf-form" onSubmit={save}>
      <div className="pf-form-head">
        <p className="pf-label">{member.registered ? "Profile" : "Finish sign-up"}</p>
        <button type="button" className="pf-link" onClick={signOut}>Sign out</button>
      </div>
      {!member.registered && (
        <>
          <Steps at={2} />
          <p className="muted su-last">Last step: pick a username. It&apos;s unique to you and shown on the leaderboard. Everything else is optional.</p>
        </>
      )}
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
        <Field
          label="Username"
          hint={
            nameState === "checking" ? "Checking…"
            : nameState === "free" ? "✓ Available"
            : nameState === "taken" ? "Taken. Try another."
            : nameState === "invalid" ? "3 to 20 lowercase letters, numbers or underscores."
            : "Unique to you. 3 to 20 lowercase letters, numbers or underscores."
          }
        >
          <div className={`pf-prefix ${nameState === "taken" || nameState === "invalid" ? "bad" : nameState === "free" ? "good" : ""}`}>
            <span>@</span>
            <input value={form.username} onChange={(e) => set("username", e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} placeholder="nightowl" maxLength={20} autoComplete="username" required />
          </div>
        </Field>
        <Field label="Display name" hint="Shown on the leaderboard if you allow it below.">
          <input value={form.name} maxLength={LIMITS.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Night Owl" autoComplete="nickname" />
        </Field>
        <Field label="Email" hint="Verified. Private: never shown publicly or shared.">
          <div className="pf-verified">
            <span>{member.email}</span>
            <button type="button" className="pf-link" onClick={() => setChangingEmail(true)}>Change</button>
          </div>
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
        <span>Show my username, name, photo and X handle on the leaderboard. Email, Telegram and website always stay private.</span>
      </label>
      <div className="pf-actions">
        <button type="button" className="pf-link danger" onClick={remove} disabled={busy !== "" || !member.registered}>Delete profile</button>
        <span className="small muted">{saved?.updatedAt ? `Saved ${new Date(saved.updatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Not saved yet"}</span>
        <button className="btn primary" type="submit" disabled={busy !== "" || (member.registered && !dirty) || nameState === "taken" || nameState === "invalid"}>
          {busy === "save" ? "Saving…" : member.registered ? "Save profile" : "Finish sign-up"}
        </button>
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
              <p className="muted">Nightshift is invite-only for now. Sign up with your email: we create your Nightshift wallet, you add your invite code and pick a username. No app or extension needed.</p>
              <button className="btn primary" onClick={() => w.loginWithEmail()}>Sign up with email</button>
              <p className="small muted">Have your own wallet (MetaMask, Rabby…)? Use <b>Connect wallet</b> at the top instead.</p>
            </div>
          </div>
        </section>
        <ProfileMarket />
      </PageShell>
    );
  return (
    <PageShell>
      <section className="block pf-page">
        <div className="wrap">
          <Identity account={w.account} name={name} />
          <div className="pf-layout single">
            <Editor account={w.account} onName={setMyName} />
          </div>
        </div>
      </section>
      <ProfileMarket />
    </PageShell>
  );
}
