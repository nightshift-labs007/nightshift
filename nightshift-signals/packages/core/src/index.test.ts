import { describe, expect, it } from "vitest";
import { MARKET_TZ, SERVICES } from "./index";

describe("@nightshift-signals/core", () => {
  it("lists every pipeline service once", () => {
    expect(new Set(SERVICES).size).toBe(SERVICES.length);
  });

  it("schedules markets in New York time", () => {
    expect(MARKET_TZ).toBe("America/New_York");
  });
});
