import "server-only";
import { formatEther, type Address } from "viem";
import { EVENING_PREFIX, ledgerAddress, stampPrediction, type Prediction } from "@/lib/algorand";
import { loadAllPairs, toSessions } from "@/lib/data";
import { kvEnabled, kvGet, kvHDel, kvHGetAll, kvHSet, kvSetEx } from "@/lib/kv";
import { people } from "@/lib/members";
import { getOracleSnapshot } from "@/lib/oracle";
import {
  OUTCOME,
  STATUS,
  algoTxToBytes32,
  bytes32ToAlgoTx,
  fromPrice8,
  sessionDate,
  sessionNum,
  toPrice8,
  tokenBytes,
  tokenName,
  type PredictRound,
  type PredictState,
} from "@/lib/predictions-shared";
import { etParts, etToUtcMs, nextSessionDate } from "@/lib/time";
import { ABI, DEPLOYMENT, sym } from "./index";
import { publicClient, readMany, roleClients } from "./keeper";

/**
 * "Call the Open" keeper jobs, run from /api/keeper every ~5 minutes with the keeper wallet (the contract's operator):
 * - members: mirror registered Nightshift users (Redis `members`) into the contract's allow-list
 * - open:    after 20:00 ET, lock Nightshift's call for the next open on Algorand and open one round per ETF on Base
 * - settle:  after the open, propose each round's official opening price; finalize undisputed proposals once the
 *            challenge window has passed; cancel anything left unsettled a day after the open
 */
const PM = () => DEPLOYMENT.predictions?.address as Address | undefined;
const PUSHED = "predict:members"; // address → time we added it on-chain
const EVENING_KEY = (session: string) => `predict:eve:${session}`; // the Algorand stamp for a session, so a retry reuses it
const MAX_BATCH = 150;
const LOOKBACK = 40; // recent rounds the settle job looks at (5 per session)

type RawRound = {
  token: `0x${string}`;
  session: number;
  strike: bigint;
  openPrice: bigint;
  openTime: number;
  lockTime: number;
  marketOpen: number;
  proposedAt: number;
  status: number;
  outcome: number;
  disputed: boolean;
  stakeHigher: bigint;
  stakeLower: bigint;
  sharesHigher: bigint;
  sharesLower: bigint;
  fee: bigint;
  algorandTx: `0x${string}`;
};

export function toRound(id: number, r: RawRound): PredictRound {
  return {
    id,
    token: tokenName(r.token),
    session: sessionDate(r.session),
    strike: fromPrice8(r.strike),
    openPrice: r.openPrice ? fromPrice8(r.openPrice) : null,
    openTime: Number(r.openTime),
    lockTime: Number(r.lockTime),
    marketOpen: Number(r.marketOpen),
    proposedAt: r.proposedAt ? Number(r.proposedAt) : null,
    status: STATUS[r.status],
    outcome: OUTCOME[r.outcome],
    disputed: r.disputed,
    stakeHigher: Number(formatEther(r.stakeHigher)),
    stakeLower: Number(formatEther(r.stakeLower)),
    sharesHigher: Number(formatEther(r.sharesHigher)),
    sharesLower: Number(formatEther(r.sharesLower)),
    algorandTx: bytes32ToAlgoTx(r.algorandTx),
  };
}

/** The most recent rounds (newest first) plus the contract's limits, for the API and the settle job. */
export async function readPredictions(lookback = LOOKBACK): Promise<PredictState> {
  const pm = PM();
  const pub = publicClient();
  const base = { rounds: [], updatedAt: new Date().toISOString() };
  if (!pm || !pub) return { enabled: false, ...base };
  const count = Number(await pub.readContract({ address: pm, abi: ABI.predictions, functionName: "roundCount" }));
  const ids = Array.from({ length: Math.min(lookback, count) }, (_, i) => count - 1 - i);
  const [maxBet, maxPerWallet, challengeWindow, minWeightBps, feeBps, ...raw] = (await readMany(pub, [
    ...["maxBet", "maxPerWallet", "challengeWindow", "minWeightBps", "feeBps"].map((functionName) => ({ address: pm, abi: ABI.predictions, functionName })),
    ...ids.map((id) => ({ address: pm, abi: ABI.predictions, functionName: "getRound", args: [BigInt(id)] })),
  ])) as [bigint, bigint, bigint, number, number, ...RawRound[]];
  return {
    enabled: true,
    address: pm,
    explorer: DEPLOYMENT.explorer,
    stakeSymbol: sym("USDG"),
    limits: { maxBet: Number(formatEther(maxBet)), maxPerWallet: Number(formatEther(maxPerWallet)), challengeWindow: Number(challengeWindow), minWeightBps: Number(minWeightBps), feeBps: Number(feeBps) },
    rounds: raw.map((r, i) => toRound(ids[i], r)),
    updatedAt: new Date().toISOString(),
  };
}

/** Registered users → the contract's allow-list (adds and removals, in batches). */
async function syncMembers(c: NonNullable<ReturnType<typeof roleClients>>, pm: Address) {
  if (!kvEnabled()) return { skipped: "no member store" };
  const [{ members }, pushed] = await Promise.all([people(), kvHGetAll(PUSHED)]);
  const add = Object.keys(members).filter((a) => !pushed[a]).slice(0, MAX_BATCH) as Address[];
  const remove = Object.keys(pushed).filter((a) => !members[a]).slice(0, MAX_BATCH) as Address[];
  const sent: string[] = [];
  for (const [list, allowed] of [[add, true], [remove, false]] as const) {
    if (!list.length) continue;
    const hash = await c.wallet.writeContract({ address: pm, abi: ABI.predictions, functionName: "setMembers", args: [list, allowed] });
    const r = await c.pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`setMembers failed: ${hash}`);
    await Promise.all(list.map((a) => (allowed ? kvHSet(PUSHED, a, String(Date.now())) : kvHDel(PUSHED, a))));
    sent.push(hash);
  }
  return { added: add.length, removed: remove.length, txs: sent };
}

/** After 20:00 ET (or later, on weekends and holidays): lock the evening call and open the next session's rounds. */
async function openRounds(c: NonNullable<ReturnType<typeof roleClients>>, pm: Address, early = false) {
  const now = Date.now();
  const snap = await getOracleSnapshot();
  if (snap.market.open) return { skipped: "market open" };
  const session = nextSessionDate(now);
  const lastClose = Math.max(...snap.quotes.map((q) => Date.parse(q.lastCloseAt)));
  // the evening call: four hours after the last close (20:00 ET on a normal day)
  if (now < lastClose + 4 * 3600_000 && !early) return { skipped: "before the evening call", session };
  const lockTime = Math.floor(etToUtcMs(session, 9, 0) / 1000);
  const marketOpen = Math.floor(etToUtcMs(session, 9, 30) / 1000);
  if (lockTime - now / 1000 < 30 * 60) return { skipped: "too close to the open", session };

  const live = snap.quotes.filter((q) => q.source === "live");
  const existing = (await readMany(
    c.pub,
    live.map((q) => ({ address: pm, abi: ABI.predictions, functionName: "roundOf", args: [tokenBytes(q.token), sessionNum(session)] })),
  )) as bigint[];
  const missing = live.filter((_, i) => existing[i] === 2n ** 256n - 1n);
  if (!missing.length) return { skipped: "rounds exist", session };

  // lock the call on Algorand once per session; a retry after a failed Base transaction reuses the same stamp
  let stamp = kvEnabled() ? (JSON.parse((await kvGet(EVENING_KEY(session))) ?? "null") as { txId: string | null; p: Record<string, number> } | null) : null;
  if (!stamp) {
    const pred: Prediction = {
      session,
      at: snap.updatedAt,
      p: Object.fromEntries(live.map((q) => [q.token, Number(q.fairValue.toFixed(4))])),
      c: Object.fromEntries(live.map((q) => [q.token, q.confidence])),
    };
    const txId = ledgerAddress() ? (await stampPrediction(pred, EVENING_PREFIX)).txId : null;
    stamp = { txId, p: pred.p };
    if (kvEnabled()) await kvSetEx(EVENING_KEY(session), JSON.stringify(stamp), 4 * 86400);
  }
  const tokens = missing.filter((q) => stamp!.p[q.token] !== undefined);
  if (!tokens.length) return { skipped: "no stamped price for the missing tokens", session };
  const hash = await c.wallet.writeContract({
    address: pm,
    abi: ABI.predictions,
    functionName: "createRounds",
    args: [
      tokens.map((q) => tokenBytes(q.token)),
      tokens.map((q) => toPrice8(stamp!.p[q.token])),
      sessionNum(session),
      Math.floor(now / 1000),
      lockTime,
      marketOpen,
      stamp.txId ? algoTxToBytes32(stamp.txId) : `0x${"0".repeat(64)}`,
    ],
  });
  const r = await c.pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`createRounds failed: ${hash}`);
  return { opened: tokens.map((q) => q.token), session, algorandTx: stamp.txId, tx: hash };
}

/** After the open: propose official opening prices, finalize undisputed ones, cancel stragglers. */
async function settleRounds(c: NonNullable<ReturnType<typeof roleClients>>, pm: Address) {
  const state = await readPredictions();
  const now = Math.floor(Date.now() / 1000);
  const challenge = state.limits?.challengeWindow ?? 7200;
  const toPropose = state.rounds.filter((r) => r.status === "Open" && now >= r.marketOpen + 180);
  const toFinalize = state.rounds.filter((r) => r.status === "Proposed" && !r.disputed && r.proposedAt !== null && now >= r.proposedAt + challenge);
  const toCancel = state.rounds.filter((r) => (r.status === "Open" || r.status === "Proposed") && now >= r.marketOpen + 86400 + 600);
  const out: Record<string, unknown> = {};

  if (toPropose.length) {
    const pairs = await loadAllPairs();
    const opens = new Map<string, number>();
    for (const p of pairs) {
      if (p.source !== "live") continue;
      for (const s of toSessions(p.etf.bars)) if (s.openT <= now) opens.set(`${p.pair.token}|${s.date}`, s.open);
    }
    const proposed: string[] = [];
    for (const r of toPropose) {
      const open = opens.get(`${r.token}|${r.session}`);
      if (!open) continue; // the official open isn't in the feed yet: try again next run
      const hash = await c.wallet.writeContract({ address: pm, abi: ABI.predictions, functionName: "propose", args: [BigInt(r.id), toPrice8(open)] });
      const rc = await c.pub.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error(`propose failed: ${hash}`);
      proposed.push(`${r.token} ${r.session}: ${open}`);
    }
    out.proposed = proposed;
  }
  if (toFinalize.length) {
    const hash = await c.wallet.writeContract({ address: pm, abi: ABI.predictions, functionName: "finalizeMany", args: [toFinalize.map((r) => BigInt(r.id))] });
    const rc = await c.pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`finalize failed: ${hash}`);
    out.finalized = toFinalize.map((r) => `${r.token} ${r.session}`);
  }
  for (const r of toCancel) {
    const hash = await c.wallet.writeContract({ address: pm, abi: ABI.predictions, functionName: "cancel", args: [BigInt(r.id)] });
    await c.pub.waitForTransactionReceipt({ hash });
    out.cancelled = [...((out.cancelled as string[]) ?? []), `${r.token} ${r.session}`];
  }
  return Object.keys(out).length ? out : { idle: true };
}

/** Adds one registered wallet to the contract's allow-list right away (the 5-minute sync would also get to it). */
export async function addMemberNow(address: string) {
  const pm = PM();
  const c = roleClients("keeper");
  if (!pm || !c) throw new Error("predictions not deployed or keeper not configured");
  const a = address.toLowerCase() as Address;
  if (await c.pub.readContract({ address: pm, abi: ABI.predictions, functionName: "isMember", args: [a] })) return { added: false, already: true };
  const hash = await c.wallet.writeContract({ address: pm, abi: ABI.predictions, functionName: "setMembers", args: [[a], true] });
  const r = await c.pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`setMembers failed: ${hash}`);
  if (kvEnabled()) await kvHSet(PUSHED, a, String(Date.now()));
  return { added: true, tx: hash };
}

/** Team-only: open the next session's rounds now instead of waiting for 20:00 ET (still only while the market is closed). */
export async function openRoundsNow() {
  const pm = PM();
  const c = roleClients("keeper");
  if (!pm || !c) return { skipped: "predictions not deployed or keeper not configured" };
  return openRounds(c, pm, true);
}

export async function runPredictions() {
  const pm = PM();
  const c = roleClients("keeper");
  if (!pm || !c) return { skipped: "predictions not deployed or keeper not configured" };
  const out: Record<string, unknown> = { at: etParts(Date.now()) };
  for (const [label, job] of [
    ["members", syncMembers],
    ["open", openRounds],
    ["settle", settleRounds],
  ] as const) {
    try {
      out[label] = await job(c, pm);
    } catch (e) {
      out[label] = { error: String(e).slice(0, 300) };
    }
  }
  return out;
}
