"use client";

import { useEffect, useState } from "react";
import type { Board } from "@/lib/play/leaderboard";
import type { PlayState } from "@/lib/play/state";
import type { Side } from "@/lib/play-rules";
import { toast } from "./Toast";
import { Turnstile } from "./Turnstile";
import { usd } from "./useApi";

const ET = "America/New_York";
const etClock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: ET });
const localClock = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
const dateDay = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export const bothClocks = (ms: number) => `${localClock(ms)} your time · ${etClock(ms)} ET`;

async function post<T>(url: string, body: unknown): Promise<{ ok: boolean; status: number; json: T & { error?: string } }> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: r.ok, status: r.status, json: (await r.json().catch(() => ({}))) as T & { error?: string } };
}

// ---------------------------------------------------------------- account: optional email sign-in, reminders

export function AccountPanel({ state, onState }: { state: PlayState; onState: (s: PlayState) => void }) {
  const [step, setStep] = useState<"idle" | "email" | "code">("idle");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [nick, setNick] = useState("");
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const a = state.account;

  if (a) {
    const toggle = async (k: "open" | "lock" | "results") => {
      const remind = { ...a.remind, [k]: !a.remind[k] };
      onState({ ...state, account: { ...a, remind } }); // show it right away; the save takes a moment
      const r = await post<PlayState>("/api/play/account/settings", { remind });
      if (r.ok) onState(r.json);
      else {
        onState(state); // put it back
        toast(r.json.error ?? "Couldn't save that.", "warn");
      }
    };
    return (
      <div className="panel pl-account">
        <div>
          Signed in as <b>{a.nick}</b> <span className="xs muted">({a.email})</span>
        </div>
        <div className="pl-remind">
          <span className="xs muted">Email me when:</span>
          {(
            [
              ["open", "a round opens"],
              ["lock", "an hour before the lock (if I haven't picked)"],
              ["results", "my results are in"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="small">
              <input type="checkbox" checked={a.remind[k]} onChange={() => toggle(k)} /> {label}
            </label>
          ))}
        </div>
        <span className="pl-account-actions">
          <button
            className="btn secondary small"
            onClick={async () => {
              await post("/api/play/account/signout", {});
              window.location.reload();
            }}
          >
            Sign out
          </button>
          <button
            className="linklike xs"
            onClick={async () => {
              if (!window.confirm("Delete your account? Your nickname, email, picks and points are removed for good. This can't be undone.")) return;
              const r = await post("/api/play/account/delete", { confirm: "delete" });
              if (!r.ok) return toast(r.json.error ?? "Couldn't delete the account.", "warn");
              toast("Your account and its picks were deleted.", "ok");
              setTimeout(() => window.location.reload(), 800);
            }}
          >
            Delete my account
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="panel pl-account">
      {step === "idle" ? (
        <>
          <span>
            <b>Keep your points and streak</b> on any device, join the leaderboard and get reminders. Optional: you can keep playing without it.
          </span>
          <button className="btn secondary small" onClick={() => setStep("email")}>
            Save my progress
          </button>
        </>
      ) : (
        <form
          className="pl-signin"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              if (step === "email") {
                const r = await post<{ note?: string }>("/api/play/account/code", { email, captcha });
                if (!r.ok) return toast(r.json.error ?? "Couldn't send the code.", "warn");
                setStep("code");
                toast(r.json.note ?? `We sent a 6-digit code to ${email}.`, "ok");
              } else {
                const r = await post<{ state: PlayState; created: boolean }>("/api/play/account/verify", { email, code, nick: nick || undefined });
                if (!r.ok) return toast(r.json.error ?? "That didn't work.", "warn");
                onState(r.json.state);
                toast(r.json.created ? `Welcome, ${r.json.state.account?.nick}. Your progress is saved.` : "Signed in. This browser's picks were added to your account.", "ok");
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          {step === "email" ? (
            <>
              <input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
              <Turnstile onToken={setCaptcha} />
            </>
          ) : (
            <>
              <input inputMode="numeric" pattern="\d{6}" required placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} aria-label="Code" />
              <input placeholder="Nickname (new players, optional)" value={nick} onChange={(e) => setNick(e.target.value.toLowerCase())} aria-label="Nickname" maxLength={16} />
            </>
          )}
          <button className="btn primary small" disabled={busy}>
            {step === "email" ? "Send code" : "Sign in"}
          </button>
          <span className="xs muted">
            We only use your email to sign you in and, if you ask, for reminders. See the <a href="/privacy">privacy policy</a>.
          </span>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Beat the AI

export function AiGame({ state, onPick, busy }: { state: PlayState; onPick: (ticker: string, side: Side) => void; busy: string }) {
  const { ai } = state;
  const now = Date.now();
  const before = now < ai.round.callAt;
  return (
    <div className="pl-ai">
      <div className="pl-section-head">
        <div>
          <p className="mono xs muted">BEAT THE AI · POINTS ONLY</p>
          <h3 className="sub-title">Above or below Nightshift&apos;s call for {dateDay(ai.round.date)}&apos;s open?</h3>
        </div>
        <span className="xs muted">
          {ai.open ? `Locks ${bothClocks(ai.round.lockAt)}` : before || !ai.call ? `Nightshift makes its call ${bothClocks(ai.round.callAt)}` : `Locked. Decided at the open, ${bothClocks(ai.round.opensAt)}`}
        </span>
      </div>
      {ai.call ? (
        <div className="pd-grid">
          {state.assets.filter((x) => ai.call![x.ticker] !== undefined).map((x) => {
            const mine = ai.myPicks[x.ticker];
            const c = ai.crowd[x.ticker];
            const total = c ? c.up + c.down : 0;
            return (
              <div key={x.ticker} className={`panel pd-card ${mine ? "pl-picked" : ""}`}>
                <div className="pd-card-top">
                  <div>
                    <span className="ticker">{x.ticker}</span>
                    <div className="xs muted">{x.name}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span className="xs muted">Nightshift&apos;s call</span>
                    <div><b className="mono">{usd(ai.call![x.ticker])}</b></div>
                  </div>
                </div>
                <div className="pd-sides">
                  {(["up", "down"] as const).map((s) => (
                    <button key={s} className={`pd-side ${s === "up" ? "higher" : "lower"} ${mine === s ? "on" : ""}`} aria-pressed={mine === s} disabled={!ai.open || busy === `ai-${x.ticker}`} onClick={() => onPick(x.ticker, s)}>
                      {s === "up" ? "▲ Above" : "▼ Below"}
                    </button>
                  ))}
                </div>
                <div className="xs muted">
                  {mine ? `You said ${mine === "up" ? "above" : "below"}. ${total > 1 ? `${Math.round(((c?.up ?? 0) / total) * 100)}% of ${total} players said above.` : "You're the first."}` : ai.open ? "Pick to see how others called it." : "Not picked."}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="panel small muted">No call yet for this round. It appears at {bothClocks(ai.round.callAt)}.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- leaderboard

export function Leaderboard({ signedIn }: { signedIn: boolean }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [tab, setTab] = useState<"week" | "all">("week");
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/play/leaderboard", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => alive && j && setBoard(j)).catch(() => {});
    load();
    const id = setInterval(load, 120_000);
    return () => ((alive = false), clearInterval(id));
  }, []);
  const rows = board ? (tab === "week" ? board.week : board.all) : [];
  return (
    <div className="panel pl-board">
      <div className="pl-section-head">
        <h3 className="sub-title">Leaderboard</h3>
        <div className="pl-tabs" role="tablist">
          {(["week", "all"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t === "week" ? "This week" : "All time"}
            </button>
          ))}
        </div>
      </div>
      {!board ? (
        <div className="small muted">Loading…</div>
      ) : rows.length ? (
        <table className="pl-table">
          <thead>
            <tr><th>#</th><th>Player</th><th className="num">Points</th><th className="num">Accuracy</th><th className="num">Streak</th></tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((r, i) => (
              <tr key={r.nick}>
                <td className="mono">{i + 1}</td>
                <td>{r.nick}</td>
                <td className="num mono">{tab === "week" ? r.week : r.points}</td>
                <td className="num mono">{r.accuracy === null ? "—" : `${Math.round(r.accuracy * 100)}%`}</td>
                <td className="num mono">{r.streak}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="small muted">No one on the board yet {tab === "week" ? "this week" : ""}. Be the first.</div>
      )}
      {!signedIn && <div className="xs muted">Save your progress (above) to appear on the leaderboard.</div>}
    </div>
  );
}

// ---------------------------------------------------------------- share

export function ShareButton({ mode, date }: { mode: "close" | "ai"; date: string }) {
  const [links, setLinks] = useState<{ url: string; x: string; telegram: string } | null>(null);
  if (links)
    return (
      <span className="pl-share">
        <a href={links.x} target="_blank" rel="noreferrer">Post on X</a>
        <a href={links.telegram} target="_blank" rel="noreferrer">Telegram</a>
        <button className="linklike" onClick={() => navigator.clipboard?.writeText(links.url).then(() => toast("Link copied.", "ok"))}>Copy link</button>
      </span>
    );
  return (
    <button
      className="linklike xs"
      onClick={async () => {
        const r = await post<{ url: string; x: string; telegram: string }>("/api/play/share", { mode, date });
        if (r.ok) setLinks(r.json);
        else toast(r.json.error ?? "Couldn't make a share link.", "warn");
      }}
    >
      Share
    </button>
  );
}
