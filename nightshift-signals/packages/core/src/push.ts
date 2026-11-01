import type { Category } from "./enums";

export interface PushPrefs {
  minSeverity: number;
  categories: Category[];
  quietStart: number | null;
  quietEnd: number | null;
  tz: string;
}

/** True during the subscriber's quiet hours [start, end) in their own time zone; wraps midnight. */
export function inQuietHours(at: Date, p: Pick<PushPrefs, "quietStart" | "quietEnd" | "tz">): boolean {
  if (p.quietStart === null || p.quietEnd === null || p.quietStart === p.quietEnd) return false;
  let hour: number;
  try {
    hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: p.tz, hour: "2-digit", hourCycle: "h23" }).format(at));
  } catch {
    hour = at.getUTCHours();
  }
  return p.quietStart < p.quietEnd ? hour >= p.quietStart && hour < p.quietEnd : hour >= p.quietStart || hour < p.quietEnd;
}

/** Does a basket alert for this event pass the subscriber's filters? Filters choose what, never when. */
export function wantsBasket(p: PushPrefs, e: { severity: number; category: Category | null }, at: Date): boolean {
  if (e.severity < p.minSeverity) return false;
  if (p.categories.length && (!e.category || !p.categories.includes(e.category))) return false;
  return !inQuietHours(at, p);
}
