import { MARKET_TZ } from "./constants";

// All market schedules are computed in America/New_York so DST shifts are handled for us.

/** NYSE full-day closures. Verify against nyse.com/markets/hours-calendars each year. */
export const NYSE_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19",
  "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18",
  "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

export const OPEN_ET = { h: 9, m: 30 };
export const CLOSE_ET = { h: 16, m: 0 };
export const GRADE_ET = { h: 9, m: 45 };

interface EtParts {
  date: string; // YYYY-MM-DD in New York
  weekday: number; // 0 = Sunday
  minutes: number; // minutes since local midnight
}

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: MARKET_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function etParts(at: Date): EtParts {
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: WEEKDAYS.indexOf(p.weekday!),
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

/** The UTC instant of a New York wall-clock time on a New York date. */
export function etToUtc(date: string, h: number, m: number): Date {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  let guess = Date.UTC(y, mo - 1, d, h, m);
  for (let i = 0; i < 2; i++) {
    const p = etParts(new Date(guess));
    const want = Date.UTC(y, mo - 1, d, h, m);
    const got = Date.UTC(...(p.date.split("-").map(Number) as [number, number, number]).map((v, j) => (j === 1 ? v - 1 : v)) as [number, number, number], Math.floor(p.minutes / 60), p.minutes % 60);
    guess += want - got;
  }
  return new Date(guess);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isTradingDay(date: string): boolean {
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  return wd !== 0 && wd !== 6 && !NYSE_HOLIDAYS.has(date);
}

export function isUsEquityOpen(at: Date): boolean {
  const p = etParts(at);
  const open = OPEN_ET.h * 60 + OPEN_ET.m;
  const close = CLOSE_ET.h * 60 + CLOSE_ET.m;
  return isTradingDay(p.date) && p.minutes >= open && p.minutes < close;
}

/** The most recent regular-session close at or before `at`. */
export function lastClose(at: Date): Date {
  let date = etParts(at).date;
  for (let i = 0; i < 10; i++, date = addDays(date, -1)) {
    if (!isTradingDay(date)) continue;
    const close = etToUtc(date, CLOSE_ET.h, CLOSE_ET.m);
    if (close <= at) return close;
  }
  throw new Error("no close in the last 10 days");
}

/** The next 9:45 ET grading time strictly after `at`, on a trading day. */
export function nextGradeTime(at: Date): Date {
  let date = etParts(at).date;
  for (let i = 0; i < 10; i++, date = addDays(date, 1)) {
    if (!isTradingDay(date)) continue;
    const t = etToUtc(date, GRADE_ET.h, GRADE_ET.m);
    if (t > at) return t;
  }
  throw new Error("no trading day in the next 10 days");
}

/** The next 9:30 ET open strictly after `at`. */
export function nextOpen(at: Date): Date {
  let date = etParts(at).date;
  for (let i = 0; i < 10; i++, date = addDays(date, 1)) {
    if (!isTradingDay(date)) continue;
    const t = etToUtc(date, OPEN_ET.h, OPEN_ET.m);
    if (t > at) return t;
  }
  throw new Error("no trading day in the next 10 days");
}

/**
 * CME Globex equity, energy, metals and rates futures: Sunday 18:00 to Friday 17:00 ET,
 * with a daily 17:00-18:00 ET maintenance break. Holiday schedules are not modeled.
 */
export function isFuturesOpen(at: Date): boolean {
  const { weekday, minutes } = etParts(at);
  const brk = minutes >= 17 * 60 && minutes < 18 * 60;
  if (weekday === 6) return false;
  if (weekday === 0) return minutes >= 18 * 60;
  if (weekday === 5) return minutes < 17 * 60;
  return !brk;
}

/** Proxies that trade 24/7 never freeze fair value. */
export const ALWAYS_OPEN_PROXIES = new Set(["BTC", "ETH"]);

export function isProxyLive(proxy: string, at: Date): boolean {
  return proxy.split("+").every((p) => ALWAYS_OPEN_PROXIES.has(p) || isFuturesOpen(at));
}
