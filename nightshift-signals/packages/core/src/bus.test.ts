import { describe, expect, it } from "vitest";
import { InMemoryBus } from "./bus";
import { makeEvent } from "./events";

const tick = (px: string) =>
  makeEvent("price.tick", { symbol: "BTC", px, src: "spot", ts: new Date().toISOString() }, { producer: "test", correlation_id: "BTC" });

describe("InMemoryBus", () => {
  it("delivers each event once per group, in order", async () => {
    const bus = new InMemoryBus();
    const a: string[] = [];
    const b: string[] = [];
    bus.subscribe("price.tick", { group: "a" }, async (e) => void a.push(e.payload.px));
    bus.subscribe("price.tick", { group: "b" }, async (e) => void b.push(e.payload.px));
    const first = tick("1");
    await bus.publish(first);
    await bus.publish(tick("2"));
    await bus.publish(first); // redelivery of the same id is skipped
    await bus.idle();
    expect(a).toEqual(["1", "2"]);
    expect(b).toEqual(["1", "2"]);
  });

  it("retries, then dead-letters", async () => {
    const bus = new InMemoryBus({ backoffMs: 0 });
    let calls = 0;
    bus.subscribe("price.tick", { group: "flaky" }, async () => {
      calls++;
      throw new Error("boom");
    });
    await bus.publish(tick("1"));
    await bus.idle();
    expect(calls).toBe(3);
    expect(bus.deadLetters).toMatchObject([{ group: "flaky", error: "boom" }]);
  });

  it("recovers when a retry succeeds", async () => {
    const bus = new InMemoryBus({ backoffMs: 0 });
    let calls = 0;
    bus.subscribe("price.tick", { group: "g" }, async () => {
      if (++calls < 2) throw new Error("transient");
    });
    await bus.publish(tick("1"));
    await bus.idle();
    expect(bus.deadLetters).toEqual([]);
  });

  it("rejects payloads that break the event schema", () => {
    expect(() =>
      makeEvent("price.tick", { symbol: "BTC", px: 1 as unknown as string, src: "spot", ts: "now" }, { producer: "t", correlation_id: "x" }),
    ).toThrow();
  });
});
