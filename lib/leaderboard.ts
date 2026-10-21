import "server-only";
import { formatEther, type Address } from "viem";
import { ABI, DEPLOYMENT, addrUrl } from "@/lib/chain";
import { publicClient, readMany } from "@/lib/chain/keeper";
import { explorerAccount, explorerTx, ledgerAddress, readJoins } from "@/lib/algorand";
import { getTransactions, type BotId } from "@/lib/transactions";
import { publicProfiles } from "@/lib/profile";

/**
 * The leaderboard: every wallet that joined (a signed message, recorded on Algorand) or used the Vault on Base
 * (read straight from the contract's position list), scored by what it has done. Nothing here is stored by the
 * site itself: both sources are public chains, so the list can't be edited.
 */
export type LeaderRow = {
  rank: number;
  address: string;
  points: number;
  joined: boolean;
  joinedAt: number | null; // unix seconds
  joinTx: string | null; // Algorand explorer link
  markets: string[]; // tokens ever deposited
  borrowing: boolean; // open debt right now
  guardian: boolean; // an auto-protect rule on any loan
  collateralUsd: number;
  debtUsd: number;
  name?: string; // from the owner's profile, only if they chose to show it
  x?: string;
};
/** An automated service that acts on Nightshift by itself. Scored by how many transactions it has sent, shown apart from people. */
export type BotRow = {
  rank: number;
  id: BotId;
  name: string;
  job: string;
  address: string | null;
  chain: "Base" | "Algorand";
  actions: number; // its points: one per transaction
  last: number | null; // unix seconds of its latest transaction
  href: string | null;
};
export type Leaderboard = {
  updatedAt: string;
  rows: LeaderRow[];
  bots: BotRow[];
  botsSince: number | null; // Base counts start here (unix seconds), or null when they cover everything
  totals: { wallets: number; joined: number; depositors: number; borrowers: number; guardians: number; collateralUsd: number };
  scoring: Record<string, number>;
  sources: { joins: "ok" | "unavailable"; vault: "ok" | "unavailable" };
};

const BOTS: Record<BotId, { name: string; job: string; chain: BotRow["chain"] }> = {
  updater: { name: "Oracle Updater", job: "Pushes the Oracle's fair values on-chain when they move or go stale.", chain: "Base" },
  keeper: { name: "Guardian Keeper", job: "Calls protect() on loans whose health fell under their owner's Guardian trigger.", chain: "Base" },
  faucet: { name: "Faucet", job: "Mints demo tokens to wallets that ask for them.", chain: "Base" },
  ledger: { name: "Ledger", job: "Stamps each pre-open prediction and every leaderboard join on Algorand.", chain: "Algorand" },
};

export const POINTS = { joined: 10, perMarket: 20, borrowing: 30, guardian: 25 };

type Pos = { user: string; col: string; collateral: bigint; debt: bigint };

async function vaultPositions(vault: Address): Promise<Pos[]> {
  const pub = publicClient();
  if (!pub) return [];
  const count = Number(await pub.readContract({ address: vault, abi: ABI.vault, functionName: "positionCount" }));
  const out: Pos[] = [];
  for (let off = 0; off < count; off += 200) {
    const [users, cols, colls, debts] = (await pub.readContract({ address: vault, abi: ABI.vault, functionName: "getPositions", args: [BigInt(off), 200n] })) as [Address[], Address[], bigint[], bigint[]];
    users.forEach((u, i) => out.push({ user: u.toLowerCase(), col: cols[i].toLowerCase(), collateral: colls[i], debt: debts[i] }));
  }
  return out;
}

let cache: { at: number; data: Leaderboard } | null = null;
const TTL_MS = 60_000;

export function invalidateLeaderboard() {
  cache = null;
}

export async function getLeaderboard(): Promise<Leaderboard> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const pub = publicClient();
  const symOf = new Map(Object.entries(DEPLOYMENT.tokens ?? {}).map(([s, t]) => [t.address.toLowerCase(), s]));

  const [joinsRes, posRes, txRes] = await Promise.allSettled([
    readJoins(),
    (async () => {
      const vaults = [DEPLOYMENT.contracts.vault, DEPLOYMENT.previous?.vault].filter(Boolean) as Address[];
      const lists = await Promise.all(vaults.map((v) => vaultPositions(v).then((ps) => ps.map((p) => ({ ...p, vault: v, current: v === DEPLOYMENT.contracts.vault })))));
      const all = lists.flat();
      // Guardian rules and prices, only for the current Vault (the one the keeper watches)
      const cur = all.filter((p) => p.current && p.debt > 0n);
      const rules = pub ? ((await readMany(pub, cur.map((p) => ({ address: DEPLOYMENT.contracts.vault, abi: ABI.vault, functionName: "rules", args: [p.user, p.col] })))) as [number, bigint, bigint][]) : [];
      const tokens = [...symOf.keys()] as Address[];
      const prices = pub ? ((await readMany(pub, tokens.map((t) => ({ address: DEPLOYMENT.contracts.oracle, abi: ABI.oracle, functionName: "getPrice", args: [t] })))) as [bigint, number, bigint][]) : [];
      const priceOf = new Map(tokens.map((t, i) => [t.toLowerCase(), Number(formatEther(prices[i]?.[0] ?? 0n))]));
      const guarded = new Set(cur.filter((_, i) => rules[i]?.[0] === 2).map((p) => p.user));
      return { all, guarded, priceOf };
    })(),
    getTransactions(),
  ]);

  const rows = new Map<string, Omit<LeaderRow, "rank" | "points">>();
  const row = (a: string) => {
    let r = rows.get(a);
    if (!r) {
      r = { address: a, joined: false, joinedAt: null, joinTx: null, markets: [], borrowing: false, guardian: false, collateralUsd: 0, debtUsd: 0 };
      rows.set(a, r);
    }
    return r;
  };

  if (joinsRes.status === "fulfilled")
    for (const j of joinsRes.value) Object.assign(row(j.address), { joined: true, joinedAt: j.at, joinTx: explorerTx(j.txId) });

  if (posRes.status === "fulfilled") {
    const { all, guarded, priceOf } = posRes.value;
    for (const p of all) {
      const r = row(p.user);
      const sym = symOf.get(p.col) ?? "?";
      if (!r.markets.includes(sym)) r.markets.push(sym);
      if (p.current) {
        r.collateralUsd += Number(formatEther(p.collateral)) * (priceOf.get(p.col) ?? 0);
        r.debtUsd += Number(formatEther(p.debt));
        if (p.debt > 0n) r.borrowing = true;
      }
      if (guarded.has(p.user)) r.guardian = true;
    }
  }

  const scored = [...rows.values()].map((r) => ({
    ...r,
    points: (r.joined ? POINTS.joined : 0) + r.markets.length * POINTS.perMarket + (r.borrowing ? POINTS.borrowing : 0) + (r.guardian ? POINTS.guardian : 0),
  }));
  scored.sort((a, b) => b.points - a.points || b.collateralUsd - a.collateralUsd || (a.joinedAt ?? Infinity) - (b.joinedAt ?? Infinity));
  const shown = await publicProfiles(scored.map((r) => r.address)).catch(() => new Map());
  const ranked: LeaderRow[] = scored.map((r, i) => {
    const p = shown.get(r.address);
    return { ...r, rank: i + 1, ...(p ? { name: p.name || undefined, x: p.x || undefined } : {}) };
  });

  const roles = DEPLOYMENT.roles;
  const wallet: Record<BotId, string | null> = { updater: roles?.updater ?? null, keeper: roles?.keeper ?? null, faucet: roles?.faucet ?? null, ledger: ledgerAddress() };
  const bots: BotRow[] = (Object.keys(BOTS) as BotId[])
    .map((id) => {
      const stat = txRes.status === "fulfilled" ? txRes.value.bots[id] : { actions: 0, last: null };
      const address = wallet[id];
      const href = address ? (BOTS[id].chain === "Base" ? addrUrl(address) : explorerAccount(address)) : null;
      return { id, ...BOTS[id], address, ...stat, href, rank: 0 };
    })
    .sort((a, b) => b.actions - a.actions)
    .map((b, i) => ({ ...b, rank: i + 1 }));

  const data: Leaderboard = {
    updatedAt: new Date().toISOString(),
    rows: ranked,
    bots,
    botsSince: txRes.status === "fulfilled" ? txRes.value.baseSince : null,
    totals: {
      wallets: ranked.length,
      joined: ranked.filter((r) => r.joined).length,
      depositors: ranked.filter((r) => r.markets.length).length,
      borrowers: ranked.filter((r) => r.borrowing).length,
      guardians: ranked.filter((r) => r.guardian).length,
      collateralUsd: ranked.reduce((s, r) => s + r.collateralUsd, 0),
    },
    scoring: POINTS,
    sources: { joins: joinsRes.status === "fulfilled" ? "ok" : "unavailable", vault: posRes.status === "fulfilled" ? "ok" : "unavailable" },
  };
  // don't cache a result with a failed source for long: try again on the next request
  if (data.sources.joins === "ok" && data.sources.vault === "ok" && txRes.status === "fulfilled") cache = { at: Date.now(), data };
  return data;
}
