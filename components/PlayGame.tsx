"use client";

import { useCallback, useEffect, useState } from "react";
import type { OracleSnapshot } from "@/lib/oracle";
import type { PlayState } from "@/lib/play/state";
import type { Side } from "@/lib/play-rules";
import type { StockBoard } from "@/lib/stocks";
import { AccountPanel, AiGame, Leaderboard, ShareButton } from "./PlayParts";
import { toast } from "./Toast";
import { signed, usd, useApi } from "./useApi";

/**
 * The free points game: will each asset open above or below its close? No wallet, no account (an anonymous cookie
 * keeps your picks in this browser). Pick first, then see how everyone else picked.
 */
const ET = "America/New_York";
const etDay = (ms: number) => new Date(ms).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: ET });
const etClock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: ET });
const localClock = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
const dateDay = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
function until(ms: number) {
  const m = Math.max(0, Math.round((ms - Date.now()) / 60000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
}

type Quote = { price: number; changePct: number; live: boolean };

export function PlayGame() {
  const [state, setState] = useState<PlayState | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string>("");
  const [, tick] = useState(0);
  const { data: board } = useApi<StockBoard>("/api/stocks", 120_000);
  const { data: snap } = useApi<OracleSnapshot>("/api/oracle", 60_000);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/play", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      setState(await r.json());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    return () => (clearInterval(id), clearInterval(t));
  }, [load]);
  // reload right after the lock, so the page moves to the next round on its own
  useEffect(() => {
    if (!state) return;
    const ms = Math.min(...[state.round.lockAt, state.ai.round.lockAt, state.ai.round.callAt].filter((t) => t > Date.now())) - Date.now() + 1500;
    if (ms <= 0 || ms > 2 ** 31 - 1) return;
    const id = setTimeout(load, ms);
    return () => clearTimeout(id);
  }, [state, load]);

  async function pick(ticker: string, side: Side, mode: "close" | "ai" = "close") {
    if (!state || busy) return;
    setBusy(mode === "ai" ? `ai-${ticker}` : ticker);
    try {
      const date = mode === "ai" ? state.ai.round.date : state.round.date;
      const r = await fetch("/api/play/pick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, date, ticker, side }) });
      const j = await r.json().catch(() => null);
      if (r.status === 409) {
        toast("That round just locked. Your pick wasn't saved; make it for the next round.", "warn");
        await load();
      } else if (!r.ok) toast(j?.error ?? "Couldn't save your pick. Please try again.", "warn");
      else setState(j);
    } catch {
      toast("Couldn't save your pick. Check your connection and try again.", "warn");
    } finally {
      setBusy("");
    }
  }

  const quote = (ticker: string): Quote | null => {
    const s = board?.stocks.find((x) => x.ticker === ticker);
    if (s) return { price: s.price, changePct: s.dayChangePct, live: s.marketOpen };
    const q = snap?.quotes.find((x) => x.token === ticker);
    if (q && q.source === "live") return { price: q.marketOpen ? q.fairValue : q.lastClose, changePct: q.marketOpen ? q.driftPct : 0, live: q.marketOpen };
    return null;
  };

  if (!state) return <div className="skeleton">{failed ? "Couldn't load the game. Retrying…" : "Loading the game…"}</div>;
  const { round, stats } = state;
  const todayIsLock = etDay(Date.now()) === etDay(round.lockAt);
  const closeName = todayIsLock ? "today's close" : `${dateDay(round.date).split(",")[0]}'s close`;
  const openName = `${dateDay(round.settleDate).split(",")[0]}'s open`;
  const wins = (stats?.wins ?? 0) + (state.aiStats?.wins ?? 0);
  const losses = (stats?.losses ?? 0) + (state.aiStats?.losses ?? 0);
  const pending = (stats?.pending ?? 0) + (state.aiStats?.pending ?? 0);
  const acc = wins + losses ? wins / (wins + losses) : null;

  return (
    <div className="pl">
      <div className="panel pd-status open">
        <div>
          <p className="mono xs muted">FREE TO PLAY · POINTS ONLY · NO WALLET NEEDED</p>
          <p className="pl-notice xs">Not financial advice. Points mode uses no real money: points have no cash value and can&apos;t be bought, sold or exchanged.</p>
          <h2>
            Up or down at {openName}?
          </h2>
          <p>
            Pick whether each one opens on {dateDay(round.settleDate)} <b>above</b> or <b>below</b> {closeName} ({dateDay(round.date)}).{" "}
            {Date.parse(round.settleDate) - Date.parse(round.date) > 86_400_000 ? "This round runs over the weekend or a market holiday. " : ""}
            You can change a pick until the lock.
          </p>
        </div>
        <div className="pd-status-side">
          <span className="xs muted">Picks lock in</span>
          <b>{until(round.lockAt)}</b>
          <span className="xs muted">
            {localClock(round.lockAt)} your time · {etClock(round.lockAt)} ET
          </span>
        </div>
      </div>

      {(stats || state.aiStats) && (
        <div className="pl-stats">
          <div className="panel"><span className="xs muted">Points</span><b>{state.points}</b><span className="xs muted">{state.week} this week</span></div>
          <div className="panel"><span className="xs muted">Streak</span><b>{stats?.streak ?? 0} {stats?.streak === 1 ? "round" : "rounds"}</b><span className="xs muted">best {stats?.bestStreak ?? 0}</span></div>
          <div className="panel">
            <span className="xs muted">Accuracy</span>
            <b>{acc === null ? "—" : `${Math.round(acc * 100)}%`}</b>
            <span className="xs muted">{wins} right · {losses} wrong{pending ? ` · ${pending} waiting` : ""}</span>
          </div>
        </div>
      )}

      <AccountPanel state={state} onState={setState} />

      <div className="pd-grid">
        {state.assets.map((a) => {
          const mine = state.myPicks[a.ticker];
          const c = state.crowd[a.ticker];
          const total = c ? c.up + c.down : 0;
          const q = quote(a.ticker);
          return (
            <div key={a.ticker} className={`panel pd-card ${mine ? "pl-picked" : ""}`}>
              <div className="pd-card-top">
                <div>
                  <span className="ticker">{a.ticker}</span>
                  <div className="xs muted">{a.name}</div>
                </div>
                {q && (
                  <div className="num" style={{ textAlign: "right" }}>
                    <b className="mono">{usd(q.price)}</b>
                    <div className={`xs mono ${q.changePct >= 0 ? "up" : "down"}`}>{q.live ? `${signed(q.changePct)} today` : "last close"}</div>
                  </div>
                )}
              </div>
              <div className="pd-sides">
                {(["up", "down"] as const).map((s) => (
                  <button
                    key={s}
                    className={`pd-side ${s === "up" ? "higher" : "lower"} ${mine === s ? "on" : ""}`}
                    aria-pressed={mine === s}
                    disabled={busy === a.ticker}
                    onClick={() => pick(a.ticker, s)}
                  >
                    {s === "up" ? "▲ Up" : "▼ Down"}
                  </button>
                ))}
              </div>
              {mine ? (
                <div className="xs muted">
                  You picked <b className={mine === "up" ? "up" : "down"}>{mine === "up" ? "Up" : "Down"}</b>.{" "}
                  {total > 1 ? `${Math.round(((c?.up ?? 0) / total) * 100)}% of ${total} players picked Up.` : "You're the first to pick this one."}
                </div>
              ) : (
                <div className="xs muted">Pick to see how others called it.</div>
              )}
            </div>
          );
        })}
      </div>

      <AiGame state={state} busy={busy} onPick={(t, side) => pick(t, side, "ai")} />

      {state.history.length > 0 && (
        <div className="panel pl-history">
          <h3 className="sub-title">Your recent rounds</h3>
          {state.history.map((h) => (
            <div key={`${h.mode}-${h.date}`} className="pl-round">
              <div className="xs muted pl-round-head">
                <span>
                  {h.mode === "ai" ? `Beat the AI · ${dateDay(h.date)} open` : `${dateDay(h.date)} close → ${dateDay(h.settleDate)} open`} ·{" "}
                  {h.status === "pending" ? "waiting for the open" : h.status === "void" ? "void: prices couldn't be confirmed, no points" : "settled"}
                </span>
                <ShareButton mode={h.mode} date={h.date} />
              </div>
              <div className="pl-picks">
                {h.picks.map((p) => (
                  <span key={p.ticker} className={`pl-pick ${p.result}`}>
                    <b className="mono">{p.ticker}</b> {p.side === "up" ? "▲" : "▼"}{" "}
                    {p.result === "win"
                      ? `✓ +${state.rules.points.correct}`
                      : p.result === "loss"
                        ? "✗"
                        : p.result === "push"
                          ? "flat, no points"
                          : p.result === "pending"
                            ? "…"
                            : "void"}
                    {p.close !== undefined && p.open !== undefined && (
                      <span className="muted"> {usd(p.close)} → {usd(p.open)}</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Leaderboard signedIn={!!state.account} />

      <details className="pl-rules small muted">
        <summary>How it works</summary>
        <ul>
          <li>Each round locks at the US market close (16:00 ET, 13:00 on early-close days) and is decided at the next open (09:30 ET). Friday&apos;s round covers the weekend. Market holidays are skipped.</li>
          <li>
            A correct pick earns {state.rules.points.correct} points. Wrong picks cost nothing. Play {state.rules.points.streakBonusFrom} rounds in a row and every
            settled round after that adds a {state.rules.points.streakBonus}-point streak bonus. Skipping a round resets your streak.
          </li>
          <li>Prices are compared to the cent. If the open equals the close, the pick is flat: no points either way.</li>
          <li>
            The close and the open come from Yahoo Finance&apos;s public price data, checked against a second reading before a round is settled. If they
            can&apos;t be confirmed within {state.rules.voidAfterHours} hours of the open, the round is void and nobody gains or loses points.
          </li>
          <li>
            Beat the AI: each evening (20:00 ET) Nightshift makes its call for each asset&apos;s next open. Say whether the open lands above or below it,
            until 04:00 ET. A correct call earns {state.rules.points.correct} points, decided to the cent like the main game. No streak bonus in this mode.
          </li>
          <li>
            Points have no money value and can&apos;t be exchanged for anything. Without an account your picks live in this browser only; save your progress
            to keep them on any device and appear on the leaderboard.
          </li>
        </ul>
      </details>
    </div>
  );
}
