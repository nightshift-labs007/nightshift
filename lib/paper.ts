"use client";

// Paper-trading account for the Vault + Guardian. Positions are marked to the live Nightshift
// Oracle and follow Morpho Blue's lending rules; state lives in this browser (localStorage).

import { useSyncExternalStore } from "react";
import { SLIPPAGE, sellAmount, sellingCanHelp } from "./guardian-rule";

export type GuardianMode = "off" | "alert" | "auto";
export type EventKind = "open" | "borrow" | "repay" | "deposit" | "withdraw" | "close" | "alert" | "protect" | "liquidated" | "info";
export type PosEvent = { t: number; kind: EventKind; msg: string };

export type Position = {
  id: string;
  token: string;
  units: number;
  debt: number;
  lltv: number;
  openedAt: number;
  openPrice: number;
  status: "open" | "closed" | "liquidated";
  guardian: { mode: GuardianMode; trigger: number; target: number; lastAlert?: number };
  events: PosEvent[];
};

export type Account = { v: 1; wallet: Record<string, number>; usdg: number; positions: Position[]; seq: number };

export type Mark = { price: number; frozen: number; confidence: number; lltv: number };
export type Marks = Record<string, Mark>;

const KEY = "nightshift.paper.v1";
export const STARTING_WALLET: Record<string, number> = { SPY: 10, QQQ: 10, GLD: 20, SLV: 100, IBIT: 200 };
export { SLIPPAGE } from "./guardian-rule";
export const MIN_OPEN_HF = 1.05;

export const lif = (lltv: number) => Math.min(1.15, 1 / (0.3 * lltv + 0.7));
export const healthFactor = (units: number, price: number, debt: number, lltv: number) =>
  debt > 0 ? (units * price * lltv) / debt : Infinity;
/** Nightshift borrow limit: the lower of oracle and frozen price, haircut by (100 - confidence) / 2 %. */
export const borrowLimit = (units: number, m: Mark) =>
  units * Math.min(m.price, m.frozen) * m.lltv * (1 - (100 - m.confidence) / 200);
export const liquidationPrice = (p: Pick<Position, "units" | "debt" | "lltv">) => (p.units > 0 ? p.debt / (p.units * p.lltv) : 0);

const fresh = (): Account => ({ v: 1, wallet: { ...STARTING_WALLET }, usdg: 0, positions: [], seq: 0 });
const usd = (x: number) => x.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

// ---------- store ----------

let state: Account | null = null;
const listeners = new Set<() => void>();

function load(): Account {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Account) : null;
    state = parsed?.v === 1 ? parsed : fresh();
  } catch {
    state = fresh();
  }
  return state;
}

function save(next: Account) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage unavailable (private mode): keep in memory
  }
  listeners.forEach((l) => l());
}

const SERVER_SNAPSHOT = fresh();
export function useAccount(): Account {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      const onStorage = (e: StorageEvent) => {
        if (e.key === KEY) {
          state = null;
          cb();
        }
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", onStorage);
      };
    },
    load,
    () => SERVER_SNAPSHOT,
  );
}

function update(fn: (a: Account) => Account | string): string | null {
  const draft = structuredClone(load());
  const out = fn(draft);
  if (typeof out === "string") return out; // validation error
  save(out);
  return null;
}

const log = (p: Position, kind: EventKind, msg: string) => {
  p.events.unshift({ t: Date.now(), kind, msg });
  p.events = p.events.slice(0, 40);
};

// ---------- actions (return an error message, or null on success) ----------

export function openPosition(token: string, units: number, borrow: number, m: Mark): string | null {
  return update((a) => {
    if (!(units > 0)) return "Enter how many units to deposit.";
    if ((a.wallet[token] ?? 0) < units - 1e-9) return `Your paper wallet only holds ${a.wallet[token] ?? 0} ${token}.`;
    if (borrow < 0) return "Borrow amount can't be negative.";
    const limit = borrowLimit(units, m);
    if (borrow > limit + 1e-6) return `The Nightshift limit for this collateral is ${usd(limit)}.`;
    a.wallet[token] -= units;
    a.usdg += borrow;
    a.seq += 1;
    const p: Position = {
      id: `NS-${String(a.seq).padStart(4, "0")}`,
      token,
      units,
      debt: borrow,
      lltv: m.lltv,
      openedAt: Date.now(),
      openPrice: m.price,
      status: "open",
      guardian: { mode: "auto", trigger: 1.15, target: 1.4 },
      events: [],
    };
    log(p, "open", `Deposited ${units} ${token} at ${usd(m.price)} and borrowed ${usd(borrow)} USDG.`);
    a.positions.unshift(p);
    return a;
  });
}

export function adjust(id: string, action: "borrow" | "repay" | "deposit" | "withdraw", amount: number, m: Mark): string | null {
  return update((a) => {
    const p = a.positions.find((x) => x.id === id && x.status === "open");
    if (!p) return "Position not found.";
    if (!(amount > 0)) return "Enter an amount.";
    switch (action) {
      case "borrow": {
        const room = borrowLimit(p.units, m) - p.debt;
        if (amount > room + 1e-6) return `You can borrow up to ${usd(Math.max(0, room))} more.`;
        p.debt += amount;
        a.usdg += amount;
        log(p, "borrow", `Borrowed ${usd(amount)} USDG.`);
        break;
      }
      case "repay": {
        const amt = Math.min(amount, p.debt);
        if (amt > a.usdg + 1e-9) return `Your paper wallet only holds ${usd(a.usdg)} USDG.`;
        p.debt -= amt;
        a.usdg -= amt;
        log(p, "repay", `Repaid ${usd(amt)} USDG.`);
        break;
      }
      case "deposit": {
        if ((a.wallet[p.token] ?? 0) < amount - 1e-9) return `Your paper wallet only holds ${a.wallet[p.token] ?? 0} ${p.token}.`;
        a.wallet[p.token] -= amount;
        p.units += amount;
        log(p, "deposit", `Added ${amount} ${p.token} collateral.`);
        break;
      }
      case "withdraw": {
        if (amount > p.units + 1e-9) return `The position only holds ${p.units} ${p.token}.`;
        const after = healthFactor(p.units - amount, m.price, p.debt, p.lltv);
        if (p.debt > 0 && after < 1.1) return "That withdrawal would push the health factor below 1.10.";
        p.units -= amount;
        a.wallet[p.token] = (a.wallet[p.token] ?? 0) + amount;
        log(p, "withdraw", `Withdrew ${amount} ${p.token}.`);
        break;
      }
    }
    return a;
  });
}

export function closePosition(id: string): string | null {
  return update((a) => {
    const p = a.positions.find((x) => x.id === id && x.status === "open");
    if (!p) return "Position not found.";
    if (p.debt > a.usdg + 1e-9) return `Repaying this loan needs ${usd(p.debt)} USDG; you hold ${usd(a.usdg)}.`;
    a.usdg -= p.debt;
    a.wallet[p.token] = (a.wallet[p.token] ?? 0) + p.units;
    log(p, "close", `Repaid ${usd(p.debt)} USDG and returned ${p.units.toFixed(4).replace(/\.?0+$/, "")} ${p.token} to the wallet.`);
    p.debt = 0;
    p.status = "closed";
    return a;
  });
}

export function setGuardian(id: string, g: Partial<Position["guardian"]>) {
  update((a) => {
    const p = a.positions.find((x) => x.id === id);
    if (!p) return "Position not found.";
    p.guardian = { ...p.guardian, ...g };
    // auto-protect must restore above the trigger, or it would fire again on the next update
    p.guardian.target = Math.max(p.guardian.target, Math.round((p.guardian.trigger + 0.05) * 100) / 100);
    return a;
  });
}

export function resetAccount() {
  save(fresh());
}

export function removeClosed() {
  update((a) => {
    a.positions = a.positions.filter((p) => p.status === "open");
    return a;
  });
}

// ---------- the Guardian ----------

export type GuardianReport = { checked: number; alerts: { id: string; token: string; msg: string }[]; actions: { id: string; msg: string }[] };

/**
 * One Guardian pass over every open position at the latest Oracle marks.
 * Liquidates below HF 1 (Morpho rules), alerts below the trigger, and with auto-protect sells
 * just enough collateral to restore the target health factor.
 */
export function guardianTick(marks: Marks): GuardianReport {
  const report: GuardianReport = { checked: 0, alerts: [], actions: [] };
  update((a) => {
    for (const p of a.positions) {
      const m = marks[p.token];
      if (p.status !== "open" || !m || p.debt <= 0) continue;
      report.checked += 1;
      const P = m.price;
      const hf = healthFactor(p.units, P, p.debt, p.lltv);

      if (hf < 1) {
        const seizedUnits = Math.min(p.units, (p.debt * lif(p.lltv)) / P);
        const msg = `Liquidated at ${usd(P)} (HF ${hf.toFixed(2)}). ${seizedUnits.toFixed(4)} ${p.token} seized for ${usd(p.debt)} USDG debt.`;
        p.units -= seizedUnits;
        p.debt = 0;
        p.status = "liquidated";
        log(p, "liquidated", msg);
        report.actions.push({ id: p.id, msg });
        continue;
      }
      if (hf >= p.guardian.trigger || p.guardian.mode === "off") continue;

      // G4: when selling can't raise health, auto-protect falls back to an alert
      const cannotHelp = p.guardian.mode === "auto" && !sellingCanHelp(p.units, P, p.debt);
      if (p.guardian.mode === "alert" || cannotHelp) {
        const quiet = p.guardian.lastAlert && Date.now() - p.guardian.lastAlert < 30 * 60 * 1000;
        if (!quiet) {
          const msg = cannotHelp
            ? `Health factor ${hf.toFixed(2)} at ${usd(P)}: selling collateral can't restore this loan, so the Guardian won't sell. Repay or add collateral.`
            : `Health factor ${hf.toFixed(2)} is below your ${p.guardian.trigger.toFixed(2)} trigger at ${usd(P)}. Repay or add collateral.`;
          p.guardian.lastAlert = Date.now();
          log(p, "alert", msg);
          report.alerts.push({ id: p.id, token: p.token, msg });
        }
        continue;
      }

      // auto-protect: sell k units at P(1 - slippage) to repay until HF = target
      const T = p.guardian.target;
      const k = sellAmount(p.units, P, p.debt, p.lltv, T);
      const repaid = Math.min(p.debt, k * P * (1 - SLIPPAGE));
      if (k <= 1e-9 || repaid <= 0) continue;
      p.units -= k;
      p.debt -= repaid;
      const msg = `Auto-protect: sold ${k.toFixed(4)} ${p.token} at ~${usd(P * (1 - SLIPPAGE))} and repaid ${usd(repaid)} USDG. HF ${hf.toFixed(2)} → ${healthFactor(p.units, P, p.debt, p.lltv).toFixed(2)}.`;
      log(p, "protect", msg);
      report.actions.push({ id: p.id, msg });
    }
    return a;
  });
  return report;
}
