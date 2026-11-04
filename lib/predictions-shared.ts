import { hexToString, toHex } from "viem";

/**
 * "Call the Open": shared between the server (keeper, API) and the browser (the Predict tab).
 * Mirrors contracts/NightshiftPredictions.sol: rounds per ETF and New York session, strike = Nightshift's evening call.
 */
export const SIDE = { Higher: 1, Lower: 2 } as const;
export const STATUS = ["None", "Open", "Proposed", "Settled", "Cancelled"] as const;
export const OUTCOME = ["None", "Higher", "Lower", "Refund"] as const;
export type Status = (typeof STATUS)[number];
export type Outcome = (typeof OUTCOME)[number];

/** A round as the API serves it: prices in dollars, times in unix seconds, amounts in whole tokens. */
export type PredictRound = {
  id: number;
  token: string;
  session: string; // YYYY-MM-DD
  strike: number;
  openPrice: number | null;
  openTime: number;
  lockTime: number;
  marketOpen: number;
  proposedAt: number | null;
  status: Status;
  outcome: Outcome;
  disputed: boolean;
  stakeHigher: number;
  stakeLower: number;
  sharesHigher: number;
  sharesLower: number;
  recordTx: string | null; // the Base transaction that locked the call
};

export type PredictState = {
  enabled: boolean;
  address?: string;
  explorer?: string;
  stakeSymbol?: string;
  stakeReal?: boolean; // real USDC (beta, small stakes) or demo tokens
  limits?: { maxBet: number; maxPerWallet: number; challengeWindow: number; minWeightBps: number; feeBps: number };
  rounds: PredictRound[];
  updatedAt: string;
};

export const tokenBytes = (t: string) => toHex(t, { size: 8 });
export const tokenName = (b: `0x${string}`) => hexToString(b, { size: 8 }).replace(/\0+$/, "");
export const sessionNum = (date: string) => Number(date.replace(/-/g, ""));
export const sessionDate = (n: number) => `${String(n).slice(0, 4)}-${String(n).slice(4, 6)}-${String(n).slice(6, 8)}`;
export const toPrice8 = (usd: number) => BigInt(Math.round(usd * 1e4)) * 10_000n; // 4 decimals, as the recorded call
export const fromPrice8 = (v: bigint) => Number(v) / 1e8;

/** The round's record: the Base transaction that locked the call (0x0… when there is none). */
export const recordTx = (hex: string): string | null => (!hex || /^0x0*$/.test(hex) ? null : hex);

/** Share weight (0–1) of a bet placed at `t`, as weightAt() in the contract. */
export function weightAt(r: Pick<PredictRound, "openTime" | "lockTime">, minWeightBps: number, t: number) {
  if (t <= r.openTime) return 1;
  if (t >= r.lockTime) return minWeightBps / 1e4;
  return 1 - ((1 - minWeightBps / 1e4) * (t - r.openTime)) / (r.lockTime - r.openTime);
}

/**
 * What a new bet of `amount` on `side` would pay if that side wins, given the pools now (stake back plus a share of
 * the other pool after the fee). Returns the multiple of the stake, e.g. 1.8.
 */
export function payoutMultiple(r: PredictRound, side: "Higher" | "Lower", amount: number, weight: number, feeBps: number) {
  if (amount <= 0) return 0;
  const shares = amount * weight;
  const mine = side === "Higher" ? r.sharesHigher : r.sharesLower;
  const other = side === "Higher" ? r.stakeLower : r.stakeHigher;
  if (other <= 0) return 1; // nothing on the other side yet: it would be a refund
  const win = (other * (1 - feeBps / 1e4) * shares) / (mine + shares);
  return (amount + win) / amount;
}
