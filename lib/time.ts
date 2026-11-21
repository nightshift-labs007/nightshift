const ET = "America/New_York";

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: ET,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

export function etParts(ms: number) {
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(new Date(ms))) p[x.type] = x.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    weekday: p.weekday, // Mon, Tue, ...
  };
}

/** Wall-clock time in New York on a given date -> UTC epoch ms. */
export function etToUtcMs(date: string, hour: number, minute: number): number {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const p = etParts(guess);
  const [py, pm, pd] = p.date.split("-").map(Number);
  const guessAsEt = Date.UTC(py, pm - 1, pd, p.hour, p.minute);
  return guess - (guessAsEt - guess);
}

export function isWeekday(weekday: string) {
  return weekday !== "Sat" && weekday !== "Sun";
}

/**
 * NYSE full-day closures and 1:00 pm early closes (nyse.com/markets/hours-calendars). Extend this list each year;
 * a missing year only means holidays are treated as normal sessions again.
 */
export const NYSE_HOLIDAYS: Record<string, string> = {
  "2026-01-01": "New Year's Day",
  "2026-01-19": "Martin Luther King Jr. Day",
  "2026-02-16": "Washington's Birthday",
  "2026-04-03": "Good Friday",
  "2026-05-25": "Memorial Day",
  "2026-06-19": "Juneteenth",
  "2026-07-03": "Independence Day (observed)",
  "2026-09-07": "Labor Day",
  "2026-11-26": "Thanksgiving Day",
  "2026-12-25": "Christmas Day",
  "2027-01-01": "New Year's Day",
  "2027-01-18": "Martin Luther King Jr. Day",
  "2027-02-15": "Washington's Birthday",
  "2027-03-26": "Good Friday",
  "2027-05-31": "Memorial Day",
  "2027-06-18": "Juneteenth (observed)",
  "2027-07-05": "Independence Day (observed)",
  "2027-09-06": "Labor Day",
  "2027-11-25": "Thanksgiving Day",
  "2027-12-24": "Christmas Day (observed)",
};
export const NYSE_EARLY_CLOSES = new Set(["2026-11-27", "2026-12-24", "2027-11-26"]);

/** Is this New York date a regular NYSE trading day? */
export function isTradingDay(date: string, weekday: string) {
  return isWeekday(weekday) && !NYSE_HOLIDAYS[date];
}
/** Regular-session close in minutes after midnight New York time (16:00, or 13:00 on early-close days). */
export function closeMinutes(date: string) {
  return NYSE_EARLY_CLOSES.has(date) ? 780 : 960;
}

/** NYSE regular session, with holidays and early closes. */
export function marketStatus(nowMs = Date.now()) {
  const p = etParts(nowMs);
  const mins = p.hour * 60 + p.minute;
  const trading = isTradingDay(p.date, p.weekday);
  const open = trading && mins >= 570 && mins < closeMinutes(p.date);
  let phase: string;
  if (open) phase = "REGULAR SESSION";
  else if (!isWeekday(p.weekday)) phase = "WEEKEND";
  else if (!trading) phase = `MARKET HOLIDAY (${NYSE_HOLIDAYS[p.date]})`;
  else if (mins < 570) phase = "PRE-DAWN / ASIA + EUROPE HOURS";
  else phase = "OVERNIGHT";
  return {
    open,
    phase,
    etTime: `${p.weekday} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")} ET`,
  };
}

/** The next regular-session date whose open has not happened yet. */
export function nextSessionDate(nowMs = Date.now()): string {
  let t = nowMs;
  for (let i = 0; i < 10; i++) {
    const p = etParts(t);
    if (isTradingDay(p.date, p.weekday) && etToUtcMs(p.date, 9, 30) > nowMs) return p.date;
    t += 86400000;
  }
  return etParts(nowMs).date;
}

export type RoundPlan =
  | { ok: true; session: string; lockTime: number; marketOpen: number }
  | { ok: false; reason: "market open" | "before the evening call" | "too close to the open"; session?: string };

/**
 * When the evening "Call the Open" rounds may be created, and their times (unix seconds). Rounds target the next
 * trading session (weekends and NYSE holidays skipped), open four hours after the last close (20:00 ET on a normal
 * day, 17:00 ET after an early close), lock at 09:00 ET and settle on the 09:30 ET open. `early` skips the evening
 * wait (team action). Pure, so it can be tested without a chain: the keeper calls it before any transaction.
 */
export function eveningRoundPlan(nowMs: number, lastCloseMs: number, opts: { marketOpen?: boolean; early?: boolean } = {}): RoundPlan {
  if (opts.marketOpen) return { ok: false, reason: "market open" };
  const session = nextSessionDate(nowMs);
  if (nowMs < lastCloseMs + 4 * 3600_000 && !opts.early) return { ok: false, reason: "before the evening call", session };
  const lockTime = Math.floor(etToUtcMs(session, 9, 0) / 1000);
  const marketOpen = Math.floor(etToUtcMs(session, 9, 30) / 1000);
  if (lockTime - nowMs / 1000 < 30 * 60) return { ok: false, reason: "too close to the open", session };
  return { ok: true, session, lockTime, marketOpen };
}

// ---------------------------------------------------------------- points game ("up or down vs last close")

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekdayOf = (date: string) => etParts(etToUtcMs(date, 12, 0)).weekday;

/** Is this New York date (YYYY-MM-DD) a regular NYSE trading day? */
export const isTradingDate = (date: string) => isTradingDay(date, weekdayOf(date));

/** The first trading date strictly after / before `date`. */
export function nextTradingDate(date: string): string {
  let d = addDays(date, 1);
  for (let i = 0; i < 15 && !isTradingDate(d); i++) d = addDays(d, 1);
  return d;
}
export function prevTradingDate(date: string): string {
  let d = addDays(date, -1);
  for (let i = 0; i < 15 && !isTradingDate(d); i++) d = addDays(d, -1);
  return d;
}

/** The regular-session close of a trading date (16:00 ET, or 13:00 ET on early-close days), as UTC epoch ms. */
export function closeUtcMs(date: string): number {
  const m = closeMinutes(date);
  return etToUtcMs(date, Math.floor(m / 60), m % 60);
}

/**
 * One round of the points game, named by its lock date D: picks lock at D's close, and the round settles on the
 * open of the next trading date (Friday's round runs over the weekend to Monday's open; holidays are skipped).
 */
export type PlayRound = { date: string; lockMs: number; settleDate: string; openMs: number };

export function playRoundFor(date: string): PlayRound {
  const settleDate = nextTradingDate(date);
  return { date, lockMs: closeUtcMs(date), settleDate, openMs: etToUtcMs(settleDate, 9, 30) };
}

/**
 * The round taking picks at `nowMs`: the first trading date whose close is still ahead. There is always exactly one,
 * so a pick can be made at any hour (overnight, at weekends) for the next close.
 */
export function currentPlayRound(nowMs: number): PlayRound {
  let d = etParts(nowMs).date;
  for (let i = 0; i < 15; i++) {
    if (isTradingDate(d) && closeUtcMs(d) > nowMs) return playRoundFor(d);
    d = addDays(d, 1);
  }
  return playRoundFor(d);
}

/** Every round from `fromDate` (a trading date) up to and including `toDate`, oldest first. */
export function playRoundsBetween(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  let d = isTradingDate(fromDate) ? fromDate : nextTradingDate(fromDate);
  for (let i = 0; i < 400 && d <= toDate; i++) {
    out.push(d);
    d = nextTradingDate(d);
  }
  return out;
}

// ---------------------------------------------------------------- "Beat the AI" (points only)

/**
 * A "Beat the AI" round is named by its session S (the open it is decided by). Nightshift's call is taken at 20:00 ET on
 * the calendar evening right before S (Sunday evening for Monday, the holiday evening after a holiday), so a call is
 * never more than 8 hours old at the lock, even after a weekend. Picks lock at 04:00 ET on S (before pre-market
 * trading starts) and the round settles on S's 09:30 ET open.
 */
export type AiRound = { date: string; callMs: number; lockMs: number; openMs: number };

export function aiRoundFor(session: string): AiRound {
  return {
    date: session,
    callMs: etToUtcMs(addDays(session, -1), 20, 0),
    lockMs: etToUtcMs(session, 4, 0),
    openMs: etToUtcMs(session, 9, 30),
  };
}

/** A stored call counts only if it was taken at or after its round's call time (an older one is stale: ignored). */
export const aiCallIsCurrent = (call: { session: string; at: number }) => call.at >= aiRoundFor(call.session).callMs;

/** The next "Beat the AI" round whose lock is still ahead (its call may not have been made yet: see callMs). */
export function currentAiRound(nowMs: number): AiRound {
  let d = etParts(nowMs).date;
  for (let i = 0; i < 15; i++) {
    if (isTradingDate(d) && etToUtcMs(d, 4, 0) > nowMs) return aiRoundFor(d);
    d = addDays(d, 1);
  }
  return aiRoundFor(d);
}
