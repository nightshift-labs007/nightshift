import { describe, expect, it } from "vitest";
import { fairValue, fitBeta, gapBps, proxyReturn, slippageBps, unitPrice } from "./fairvalue";
import { etToUtc, isFuturesOpen, isProxyLive, isUsEquityOpen, lastClose, nextGradeTime } from "./market";

describe("market clock", () => {
  it("handles both sides of the November DST change", () => {
    expect(etToUtc("2026-10-30", 9, 45).toISOString()).toBe("2026-10-30T13:45:00.000Z"); // EDT
    expect(etToUtc("2026-11-02", 9, 45).toISOString()).toBe("2026-11-02T14:45:00.000Z"); // EST
  });

  it("grades Friday-night baskets on Monday, skipping holidays", () => {
    expect(nextGradeTime(new Date("2026-10-24T02:00:00Z")).toISOString()).toBe("2026-10-26T13:45:00.000Z");
    // Thanksgiving Thursday 2026-11-26 is closed, so Wednesday night grades on Friday.
    expect(nextGradeTime(new Date("2026-11-26T03:00:00Z")).toISOString()).toBe("2026-11-27T14:45:00.000Z");
  });

  it("knows the last close and regular hours", () => {
    expect(lastClose(new Date("2026-10-22T06:00:00Z")).toISOString()).toBe("2026-10-21T20:00:00.000Z");
    expect(isUsEquityOpen(new Date("2026-10-21T14:00:00Z"))).toBe(true);
    expect(isUsEquityOpen(new Date("2026-10-21T21:00:00Z"))).toBe(false);
  });

  it("freezes futures proxies on weekends and in the daily break, never BTC", () => {
    const saturday = new Date("2026-10-24T16:00:00Z");
    expect(isFuturesOpen(saturday)).toBe(false);
    expect(isProxyLive("BTC", saturday)).toBe(true);
    expect(isProxyLive("CL+ES", saturday)).toBe(false);
    expect(isFuturesOpen(new Date("2026-10-21T21:30:00Z"))).toBe(false); // 17:30 EDT break
    expect(isFuturesOpen(new Date("2026-10-22T06:00:00Z"))).toBe(true);
  });
});

describe("fair value", () => {
  it("applies FV = close × (1 + β × Δproxy)", () => {
    const d = proxyReturn([{ now: "102", close: "100" }]);
    expect(fairValue("50", "1.5", d)).toBe("51.500000000000000000");
    expect(gapBps("52.015", "51.5")).toBe(100);
  });

  it("blends multi-part proxies equally", () => {
    expect(Number(proxyReturn([{ now: "104", close: "100" }, { now: "100", close: "100" }]))).toBeCloseTo(0.02, 12);
  });

  it("prices quotes and slippage without floats", () => {
    expect(unitPrice("1000", "10.869565217391304347")).toMatch(/^92\.0000000000/);
    expect(slippageBps("92.46", "92.00")).toBe(50);
    expect(slippageBps("91.9", "92")).toBe(0);
  });

  it("fits beta with an intercept and refuses tiny samples", () => {
    const xs = Array.from({ length: 30 }, (_, i) => (i - 15) / 1000);
    expect(fitBeta(xs, xs.map((x) => 0.001 + 1.3 * x))).toBeCloseTo(1.3, 9);
    expect(fitBeta([0.01], [0.02])).toBeNull();
  });
});
