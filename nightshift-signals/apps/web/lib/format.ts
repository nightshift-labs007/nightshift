// Up and down are never shown by color alone: every figure carries a sign, and results carry a word.

export function pct(fraction: string | number | null | undefined, digits = 2): string {
  if (fraction === null || fraction === undefined || fraction === "") return "—";
  const v = Number(fraction) * 100;
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}%`;
}

export function pctPoints(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return "—";
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}%`;
}

export function bps(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v)} bps`;
}

export function price(v: string | null | undefined): string {
  if (!v) return "—";
  const n = Number(v);
  return n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n.toFixed(n >= 1 ? 2 : 4);
}

export function weight(w: number) {
  return `${Math.round(w * 100)}%`;
}

export function shortHash(h: string | null | undefined) {
  return h ? `${h.slice(0, 8)}…${h.slice(-6)}` : "—";
}

export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function etTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) + " ET";
}

