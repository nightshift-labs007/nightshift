// Up and down are never shown by color alone: every figure carries a sign, and results carry a word.

export function pct(fraction: string | number | null | undefined, digits = 2) {
  if (fraction === null || fraction === undefined) return "—";
  const v = Number(fraction) * 100;
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}%`;
}

export function pctPoints(v: number | null | undefined, digits = 2) {
  if (v === null || v === undefined) return "—";
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}%`;
}

export function result(grade: { vs_spy_pct: string; hit: boolean } | null) {
  if (!grade) return "Grades 9:45 ET";
  return `${grade.hit ? "▲ Beat SPY" : "▼ Missed"} ${pct(grade.vs_spy_pct)}`;
}

export const colors = {
  ink: "#0d111a",
  panel: "#161b29",
  line: "#2a3046",
  paper: "#f3efe6",
  muted: "#9aa1b5",
  hot: "#ff8a3d",
  cool: "#6aaeff",
  beat: "#4f93e6",
  miss: "#dc6a24",
};
