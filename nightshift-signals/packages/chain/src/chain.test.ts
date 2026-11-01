import { sampleBasket } from "@nightshift-signals/core/testing";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import { LEDGER_ABI } from "./abi";
import { basketHash, basketKey } from "./hash";
import { SimulatedLedger } from "./ledger";

const solc = createRequire(import.meta.url)("solc") as { compile(input: string): string };

describe("NightshiftSignalsLedger.sol", () => {
  it("compiles and matches the ABI the committer uses", () => {
    const source = readFileSync(new URL("../contracts/NightshiftSignalsLedger.sol", import.meta.url), "utf8");
    const out = JSON.parse(
      solc.compile(
        JSON.stringify({
          language: "Solidity",
          sources: { "NightshiftSignalsLedger.sol": { content: source } },
          settings: { outputSelection: { "*": { "*": ["abi"] } } },
        }),
      ),
    ) as { errors?: { severity: string; message: string }[]; contracts: Record<string, Record<string, { abi: unknown[] }>> };
    expect(out.errors?.filter((e) => e.severity === "error") ?? []).toEqual([]);
    const abi = out.contracts["NightshiftSignalsLedger.sol"]!.NightshiftSignalsLedger!.abi;
    const sorted = (x: unknown): unknown =>
      Array.isArray(x) ? x.map(sorted) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).sort().map(([k, v]) => [k, sorted(v)])) : x;
    const sortKey = (x: unknown) => JSON.stringify(sorted(x));
    expect([...abi].map(sortKey).sort()).toEqual([...LEDGER_ABI].map(sortKey).sort());
  });
});

describe("hashing", () => {
  it("hashes the canonical JSON, so anyone can recompute it", () => {
    const b = sampleBasket();
    expect(basketHash(b)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(basketHash({ ...b, status: "published", published_at: "2026-10-21T06:14:40Z" })).toBe(basketHash(b));
    expect(basketKey(b.id)).toBe(keccak256(toBytes("bkt_20261021_0214_a")));
  });

  it("simulated commits are labeled chain 0", async () => {
    const l = new SimulatedLedger();
    expect(l.chainId).toBe(0);
    expect((await l.commit("bkt_x", basketHash(sampleBasket()))).status).toBe("confirmed");
  });
});
