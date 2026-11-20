import "server-only";
import { PLAY_ASSETS, PLAY_TICKERS, scorePick } from "@/lib/play-rules";
import { closeUtcMs, currentAiRound, currentPlayRound, playRoundFor, prevTradingDate } from "@/lib/time";
import { accountUids, getAccount, unsubscribeUrl, type Account } from "./account";
import { getAiCall } from "./ai";
import { sendMail, siteOrigin } from "./mail";
import { getPicks, getResult, sSetNX, tryLock, type Mode } from "./store";

/**
 * Email reminders for signed-in players who opted in (each type separately), sent from the keeper and after page
 * loads. Every message goes to a player at most once (a per-player "sent" marker), and only inside its window, so a
 * late or repeated run never sends stale reminders.
 *
 *   open     a new up/down round is taking picks (just after the previous close), and Nightshift's evening call is up
 *   lock     one hour before the close, if you haven't picked every asset yet
 *   results  your results, once a round you played is settled
 */
const ET = "America/New_York";
const etText = (ms: number) => new Date(ms).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: ET }) + " ET";
const dayText = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const MAX_PER_RUN = 200;

type Job = { kind: string; key: string; to: Account; subject: string; body: string[] };

const footer = (a: Account) => {
  const u = unsubscribeUrl(a.email);
  return ["", `Play: ${siteOrigin()}/app#predict`, "Points only: no money, nothing to buy. Not investment advice.", ...(u ? [`Stop these emails: ${u}`] : [])];
};

async function jobsFor(a: Account, now: number): Promise<Job[]> {
  const jobs: Job[] = [];
  const cur = currentPlayRound(now);
  const opened = closeUtcMs(prevTradingDate(cur.date)); // the previous lock is when this round started taking picks

  if (a.remind.open && now >= opened && now < opened + 3 * 3600_000) {
    jobs.push({
      kind: "open",
      key: `open:${cur.date}`,
      to: a,
      subject: `New round: up or down at ${dayText(cur.settleDate)}'s open?`,
      body: [`A new round is open: will ${PLAY_ASSETS.map((x) => x.name).join(", ")} open above or below ${dayText(cur.date)}'s close?`, `Picks lock at ${etText(cur.lockMs)}.`],
    });
  }
  const ai = currentAiRound(now);
  if (a.remind.open && now >= ai.callMs && now < Math.min(ai.callMs + 3 * 3600_000, ai.lockMs) && (await getAiCall(ai.date))) {
    jobs.push({
      kind: "open-ai",
      key: `open-ai:${ai.date}`,
      to: a,
      subject: `Beat the AI: Nightshift's call for ${dayText(ai.date)} is up`,
      body: [`Nightshift has made its call for ${dayText(ai.date)}'s open. Do you think the open lands above or below it?`, `Picks lock at ${etText(ai.lockMs)}.`],
    });
  }
  if (a.remind.lock && now >= cur.lockMs - 60 * 60_000 && now < cur.lockMs - 10 * 60_000) {
    const mine = (await getPicks(a.uid, "close"))[cur.date] ?? {};
    const left = PLAY_TICKERS.filter((t) => !mine[t]);
    if (left.length) {
      jobs.push({
        kind: "lock",
        key: `lock:${cur.date}`,
        to: a,
        subject: `Picks lock in under an hour`,
        body: [`This round locks at ${etText(cur.lockMs)}.`, `Still to pick: ${left.join(", ")}.`],
      });
    }
  }
  if (a.remind.results) {
    for (const mode of ["close", "ai"] as Mode[]) {
      const picks = await getPicks(a.uid, mode);
      for (const date of Object.keys(picks).sort().slice(-3)) {
        const r = await getResult(date, mode);
        if (!r || now - r.settledAt > 24 * 3600_000) continue; // only fresh results
        const lines =
          r.status === "void"
            ? ["This round was void (prices couldn't be confirmed), so no points either way."]
            : Object.entries(picks[date]).map(([t, side]) => {
                const res = scorePick(side, r, t);
                const p = r.assets[t];
                return `${t}: you said ${side}, ${p ? `$${p.close.toFixed(2)} → $${p.open.toFixed(2)}` : ""} ${res === "win" ? "✓ right" : res === "loss" ? "✗ wrong" : res === "push" ? "flat, no points" : ""}`.trim();
              });
        const label = mode === "ai" ? `Beat the AI, ${dayText(date)} open` : `${dayText(date)} close → ${dayText(playRoundFor(date).settleDate)} open`;
        jobs.push({ kind: `results-${mode}`, key: `results-${mode}:${date}`, to: a, subject: `Your results: ${label}`, body: lines });
      }
    }
  }
  return jobs;
}

export async function runReminders(now: number): Promise<{ sent: number; failed: number; skipped?: string }> {
  if (!(await tryLock("play:reminding", 60))) return { sent: 0, failed: 0, skipped: "another run is in progress" };
  let sent = 0;
  let failed = 0;
  for (const uid of await accountUids()) {
    if (sent >= MAX_PER_RUN) break;
    const a = await getAccount(uid);
    if (!a || !(a.remind.open || a.remind.lock || a.remind.results)) continue;
    for (const j of await jobsFor(a, now)) {
      if (!(await sSetNX(`play:sent:${j.key}:${uid}`, "1", 14 * 86400))) continue; // already sent to this player
      const r = await sendMail({ to: a.email, subject: j.subject, text: [...j.body, ...footer(a)].join("\n"), unsubscribeUrl: unsubscribeUrl(a.email) ?? undefined });
      if (r.ok) sent++;
      else failed++;
    }
  }
  return { sent, failed };
}
