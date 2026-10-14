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
