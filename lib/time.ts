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

/** NYSE regular session (holidays not modelled). */
export function marketStatus(nowMs = Date.now()) {
  const p = etParts(nowMs);
  const mins = p.hour * 60 + p.minute;
  const open = isWeekday(p.weekday) && mins >= 570 && mins < 960;
  let phase: string;
  if (open) phase = "REGULAR SESSION";
  else if (!isWeekday(p.weekday)) phase = "WEEKEND";
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
  for (let i = 0; i < 8; i++) {
    const p = etParts(t);
    if (isWeekday(p.weekday) && etToUtcMs(p.date, 9, 30) > nowMs) return p.date;
    t += 86400000;
  }
  return etParts(nowMs).date;
}
