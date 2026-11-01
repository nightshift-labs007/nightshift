/** Mirror of LiveState in packages/adapters/src/notify/live-activity.ts and ContentState in Swift. */
export interface LiveState {
  status: "tracking" | "graded" | "void";
  retPct: number;
  vsSpyPct: number | null;
  legs: { ticker: string; chgPct: number }[];
  updatedAt: number;
}

const sign = (v: number) => `${v > 0 ? "▲ +" : v < 0 ? "▼ −" : "± "}${Math.abs(v).toFixed(2)}%`;

/** Text for the Android ongoing notification (iOS draws the same state in the Live Activity). */
export function notificationText(headline: string, s: LiveState): { title: string; body: string } {
  if (s.status === "void") return { title: "Basket voided at the open", body: headline };
  if (s.status === "graded") {
    return {
      title: `Your basket closed ${sign(s.retPct)} at the open`,
      body: `${s.vsSpyPct === null ? "" : `${sign(s.vsSpyPct)} vs SPY · `}${headline}`,
    };
  }
  return { title: `${sign(s.retPct)} · tracking until 9:45 ET`, body: s.legs.map((l) => `${l.ticker} ${sign(l.chgPct)}`).join("  ") };
}
