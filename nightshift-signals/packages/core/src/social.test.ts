import { describe, expect, it } from "vitest";
import { inQuietHours, wantsBasket } from "./push";
import { crowdHit, gradePosition, leaderboard, leagueWeek, tally, voteOpen } from "./social";

describe("follow or fade", () => {
  it("locks votes 30 minutes after publish", () => {
    const p = new Date("2026-10-22T06:00:00Z");
    expect(voteOpen(p, new Date("2026-10-22T06:29:59Z"))).toBe(true);
    expect(voteOpen(p, new Date("2026-10-22T06:30:01Z"))).toBe(false);
  });

  it("grades the crowd like the AI", () => {
    expect(tally(["follow", "fade", "follow"])).toEqual({ follow: 2, fade: 1, call: "follow" });
    expect(tally(["follow", "fade"]).call).toBeNull();
    expect(crowdHit("follow", true)).toBe(true);
    expect(crowdHit("fade", true)).toBe(false);
    expect(crowdHit("fade", false)).toBe(true);
    expect(crowdHit(null, true)).toBeNull();
  });
});

describe("paper league", () => {
  it("grades a position on the user's own entries", () => {
    const g = gradePosition(
      [
        { token_symbol: "XLE", quote_price: "100", quote_size_usdg: "60" },
        { token_symbol: "GLD", quote_price: "200", quote_size_usdg: "40" },
      ],
      new Map([["XLE", "102"], ["GLD", "199"]]),
      "0.005",
    )!;
    // 60 × 2% + 40 × −0.5% = 1.0 USDG on 100
    expect(g.ret_pct).toBe("0.0100000000");
    expect(g.vs_spy_pct).toBe("0.0050000000");
    expect(Number(g.pnl_usdg)).toBe(1);
  });

  it("runs weeks Monday to Monday in New York", () => {
    const w = leagueWeek(new Date("2026-10-22T06:00:00Z")); // Thursday
    expect(w.label).toBe("2026-10-19");
    expect(w.start.toISOString()).toBe("2026-10-19T04:00:00.000Z");
  });

  it("ranks by paper P/L and awards streak badges", () => {
    const at = (d: number) => new Date(Date.UTC(2026, 9, 20 + d));
    const rows = leaderboard([
      { user_id: "a", graded_at: at(0), pnl_usdg: "1", vs_spy_pct: "0.01" },
      { user_id: "a", graded_at: at(1), pnl_usdg: "2", vs_spy_pct: "0.02" },
      { user_id: "a", graded_at: at(2), pnl_usdg: "1", vs_spy_pct: "0.01" },
      { user_id: "b", graded_at: at(0), pnl_usdg: "-1", vs_spy_pct: "-0.01" },
    ]);
    expect(rows.map((r) => r.user_id)).toEqual(["a", "b"]);
    expect(rows[0]).toMatchObject({ pnl_usdg: 4, streak: 3, beat_spy: 3 });
    expect(rows[0]!.badges).toEqual(["first_receipt", "hot_hand"]);
  });
});

describe("push preferences", () => {
  const prefs = { minSeverity: 3, categories: [], quietStart: 23, quietEnd: 7, tz: "Asia/Kolkata" };

  it("respects quiet hours in the subscriber's own time zone, across midnight", () => {
    expect(inQuietHours(new Date("2026-10-22T19:00:00Z"), prefs)).toBe(true); // 00:30 IST
    expect(inQuietHours(new Date("2026-10-22T06:00:00Z"), prefs)).toBe(false); // 11:30 IST
  });

  it("filters by severity and category", () => {
    const day = new Date("2026-10-22T06:00:00Z");
    expect(wantsBasket(prefs, { severity: 2, category: "semis_export" }, day)).toBe(false);
    expect(wantsBasket({ ...prefs, categories: ["monetary_policy"] }, { severity: 4, category: "semis_export" }, day)).toBe(false);
    expect(wantsBasket(prefs, { severity: 4, category: "semis_export" }, day)).toBe(true);
  });
});
