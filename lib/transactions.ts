import "server-only";
import { decodeEventLog, formatEther, zeroAddress, type Address, type Log } from "viem";
import { ABI, DEPLOYMENT, addrUrl, txUrl } from "@/lib/chain";
import { publicClient } from "@/lib/chain/keeper";
import { explorerTx, ledgerAddress, readJoins, readStamps } from "@/lib/algorand";

/**
 * Every transaction Nightshift is behind, in one list: Vault activity, Oracle price pushes, Cloak attestations
 * and faucet mints on Base, plus prediction stamps and leaderboard joins on Algorand. Nothing is stored by the
 * site: each row is read back from a public chain and links to its explorer, so the list can't be edited.
 */
export type BotId = "updater" | "keeper" | "faucet" | "ledger";
export type TxKind = "deposit" | "borrow" | "repay" | "withdraw" | "protect" | "liquidation" | "rule" | "price" | "attest" | "faucet" | "prediction" | "join";
export type TxRow = {
  id: string; // tx hash (Base) or tx id (Algorand)
  chain: "Base" | "Algorand";
  kind: TxKind;
  title: string;
  detail: string;
  actor: string | null; // wallet that did it (the user, or a bot's wallet)
  actorUrl: string | null;
  bot: BotId | null; // set when an automated service sent it
  at: number; // unix seconds
  href: string; // explorer link
};
export type Flow = { count: number; latest: { id: string; at: number; href: string; chain: TxRow["chain"] } };
export type BotStat = { actions: number; last: number | null };
export type Transactions = {
  updatedAt: string;
  rows: TxRow[];
  bots: Record<BotId, BotStat>;
  /** per kind of transaction: how many there are in the period covered, and the latest one */
  flows: Partial<Record<TxKind, Flow>>;
  /** unix seconds the Base counts start from, or null when they cover everything since launch */
  baseSince: number | null;
  sources: { base: "ok" | "unavailable"; algorand: "ok" | "unavailable" };
};

const FEED_LIMIT = 200;
const CHUNK = 9_000; // blocks per getLogs: the free public RPCs refuse ranges of 10,000 or more
const MAX_BACK_STEPS = 40; // ~8 days of history per request
const BLOCK_SECONDS = 2; // Base

type Ev = { addr: string; block: bigint; hash: string; index: number; name: string; args: Record<string, unknown>; contract: "vault" | "oracle" | "cloak" | "token" };

const fmt = (v: bigint, d = 4) => Number(formatEther(v)).toLocaleString("en-US", { maximumFractionDigits: d });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// ---------------------------------------------------------------- Base: read the contracts' logs
// Free public RPCs only answer getLogs for recent blocks and in ranges under 10,000, so history is read newest-first
// in 9,000-block steps until the RPC refuses (or the deployment's first block is reached). With a keyed archive RPC
// (BASE_RPC_URL) that reaches all the way back; without one the page shows what the free RPC can still see, and says so.
// Blocks on Base are exactly 2 seconds apart, so a block's time is worked out from the latest block's header.
const scanned = { newest: 0n, oldest: 0n, events: [] as Ev[], headAt: 0, head: 0n, reachedStart: false };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(get: () => Promise<T>): Promise<T> {
  try {
    return await get();
  } catch {
    await sleep(600); // rate limit: try once more
    return get();
  }
}

async function scanBase() {
  const pub = publicClient();
  if (!pub) return null;
  const head = await pub.getBlockNumber();
  const start = BigInt(DEPLOYMENT.upgradeStartBlock ?? DEPLOYMENT.startBlock);
  const { vault, oracle, cloakRegistry } = DEPLOYMENT.contracts;
  const tokens = Object.values(DEPLOYMENT.tokens ?? {}).map((t) => t.address);
  const mint = ABI.token.find((x) => x.type === "event" && x.name === "Transfer")!;
  const abiOf = new Map<string, [Ev["contract"], readonly unknown[]]>([
    [vault.toLowerCase(), ["vault", ABI.vault]],
    [oracle.toLowerCase(), ["oracle", ABI.oracle]],
    ...(cloakRegistry ? [[cloakRegistry.toLowerCase(), ["cloak", ABI.cloakRegistry]] as [string, [Ev["contract"], readonly unknown[]]]] : []),
    ...tokens.map((t) => [t.toLowerCase(), ["token", ABI.token]] as [string, [Ev["contract"], readonly unknown[]]]),
  ]);
  const chunk = async (from: bigint, to: bigint) => {
    const [ours, mints] = await Promise.all([
      withRetry(() => pub.getLogs({ address: [vault, oracle, ...(cloakRegistry ? [cloakRegistry] : [])], fromBlock: from, toBlock: to })),
      // only mints (from the zero address) are the faucet; user-to-user transfers are not Nightshift's business
      withRetry(() => pub.getLogs({ address: tokens, event: mint as never, args: { from: zeroAddress } as never, fromBlock: from, toBlock: to }) as Promise<Log[]>),
    ]);
    const out: Ev[] = [];
    for (const log of [...ours, ...mints]) {
      const [contract, abi] = abiOf.get(log.address.toLowerCase()) ?? [];
      if (!abi || !contract) continue;
      try {
        const d = decodeEventLog({ abi: abi as never, data: log.data, topics: log.topics as never });
        out.push({ addr: log.address, block: log.blockNumber!, hash: log.transactionHash!, index: log.logIndex!, name: String(d.eventName), args: (d.args ?? {}) as Record<string, unknown>, contract });
      } catch { /* an event this page doesn't show */ }
    }
    return out;
  };
  const STEP = BigInt(CHUNK);

  if (!scanned.newest) {
    scanned.headAt = Number((await pub.getBlock({ blockNumber: head })).timestamp);
    scanned.head = head;
    scanned.newest = scanned.oldest = head + 1n; // nothing scanned yet; the first backward step starts at head
  } else if (head > scanned.newest - 1n) {
    // new blocks since the last read
    const fresh: Ev[] = []; // kept apart until every range is read, so a failure part-way doesn't leave duplicates
    for (let f = scanned.newest; f <= head; f += STEP) fresh.push(...(await chunk(f, f + STEP - 1n > head ? head : f + STEP - 1n)));
    scanned.events.push(...fresh);
    scanned.newest = head + 1n;
    scanned.head = head;
    scanned.headAt = Number((await pub.getBlock({ blockNumber: head })).timestamp);
  }
  // older history, newest-first, until the RPC refuses
  for (let n = 0; !scanned.reachedStart && n < MAX_BACK_STEPS; n++) {
    const to = scanned.oldest - 1n;
    const from = to - STEP + 1n < start ? start : to - STEP + 1n;
    if (to < start) { scanned.reachedStart = true; break; }
    try {
      scanned.events.push(...(await chunk(from, to)));
    } catch {
      break;
    }
    scanned.oldest = from;
    if (from === start) scanned.reachedStart = true;
  }
  const at = (b: bigint) => scanned.headAt - Number(scanned.head - b) * BLOCK_SECONDS;
  return { events: scanned.events, at, since: scanned.reachedStart ? null : at(scanned.oldest) };
}

const symOf = () => new Map(Object.entries(DEPLOYMENT.tokens ?? {}).map(([s, t]) => [t.address.toLowerCase(), s]));

async function baseRows(): Promise<{ rows: TxRow[]; bots: Pick<Record<BotId, BotStat>, "updater" | "keeper" | "faucet">; since: number | null }> {
  const scan = await scanBase();
  const bots = { updater: { actions: 0, last: null }, keeper: { actions: 0, last: null }, faucet: { actions: 0, last: null } } as Pick<Record<BotId, BotStat>, "updater" | "keeper" | "faucet">;
  if (!scan) return { rows: [], bots, since: null };
  const syms = symOf();
  const sym = (a: unknown) => syms.get(String(a).toLowerCase()) ?? "token";
  const roles = DEPLOYMENT.roles;

  // one row per transaction for the bots (a price push or a multi-token drip is a single transaction)
  type Draft = { ev: Ev; row: Omit<TxRow, "at" | "id" | "chain" | "href"> };
  const drafts = new Map<string, Draft & { count: number }>();
  const add = (key: string, d: Draft) => {
    const prev = drafts.get(key);
    if (prev) { prev.count++; prev.row.detail += `, ${d.row.detail}`; } else drafts.set(key, { ...d, count: 1 });
  };
  for (const ev of scan.events) {
    const a = ev.args as Record<string, any>;
    const user = a.user ? String(a.user) : null;
    const base = { actor: user, actorUrl: user ? addrUrl(user) : null, bot: null as BotId | null };
    switch (ev.name) {
      case "Deposit": add(`${ev.hash}:${ev.index}`, { ev, row: { ...base, kind: "deposit", title: "Deposit", detail: `${fmt(a.amount)} ${sym(a.collateral)} as collateral` } }); break;
      case "Withdraw": add(`${ev.hash}:${ev.index}`, { ev, row: { ...base, kind: "withdraw", title: "Withdraw", detail: `${fmt(a.amount)} ${sym(a.collateral)} collateral` } }); break;
      case "Borrow": add(`${ev.hash}:${ev.index}`, { ev, row: { ...base, kind: "borrow", title: "Borrow", detail: `${fmt(a.amount, 2)} USDG against ${sym(a.collateral)}` } }); break;
      case "Repay": add(`${ev.hash}:${ev.index}`, { ev, row: { ...base, kind: "repay", title: "Repay", detail: `${fmt(a.amount, 2)} USDG on ${sym(a.collateral)}` } }); break;
      case "RuleSet": add(`${ev.hash}:${ev.index}`, { ev, row: { ...base, kind: "rule", title: "Guardian rule", detail: `${sym(a.collateral)} auto-protection ${Number(a.mode) === 2 ? "switched on" : "updated"}` } }); break;
      case "Protected":
        add(`${ev.hash}:${ev.index}`, { ev, row: { ...base, bot: "keeper", actor: roles?.keeper ?? null, actorUrl: roles?.keeper ? addrUrl(roles.keeper) : null, kind: "protect", title: "Guardian protected a loan", detail: `${short(user ?? "")}: sold ${fmt(a.soldCollateral)} ${sym(a.collateral)}, repaid ${fmt(a.repaidDebt, 2)} USDG, health ${fmt(a.hfBefore, 2)} → ${fmt(a.hfAfter, 2)}` } });
        break;
      case "Liquidated": add(`${ev.hash}:${ev.index}`, { ev, row: { ...base, kind: "liquidation", title: "Liquidation", detail: `${fmt(a.repaidDebt, 2)} USDG repaid, ${fmt(a.seizedCollateral)} ${sym(a.collateral)} seized` } }); break;
      case "PriceUpdated":
        add(ev.hash, { ev, row: { actor: roles?.updater ?? null, actorUrl: roles?.updater ? addrUrl(roles.updater) : null, bot: "updater", kind: "price", title: "Oracle price update", detail: `${sym(a.token)} ${fmt(a.price, 2)}` } });
        break;
      case "Attested": add(`${ev.hash}:${ev.index}`, { ev, row: { actor: a.by ? String(a.by) : null, actorUrl: a.by ? addrUrl(String(a.by)) : null, bot: null, kind: "attest", title: "Cloak proof attested", detail: `${sym(a.token)} solvency proof, priced at $${(Number(a.priceCents) / 100).toFixed(2)}` } }); break;
      case "Transfer":
        add(`${ev.hash}:${String(a.to)}`, { ev, row: { actor: roles?.faucet ?? null, actorUrl: roles?.faucet ? addrUrl(roles.faucet) : null, bot: "faucet", kind: "faucet", title: "Faucet drip", detail: `${fmt(a.value, 2)} ${sym(ev.addr)}` } });
        break;
    }
  }
  const all = [...drafts.values()];
  const rows: TxRow[] = [];
  for (const d of all) {
    const at = scan.at(d.ev.block);
    if (d.row.bot) {
      const stat = bots[d.row.bot as keyof typeof bots];
      stat.actions++;
      stat.last = Math.max(stat.last ?? 0, at);
    }
    rows.push({ ...d.row, id: d.ev.hash, chain: "Base", at, href: txUrl(d.ev.hash) });
  }
  return { rows, bots, since: scan.since };
}

// ---------------------------------------------------------------- Algorand: prediction stamps and leaderboard joins
async function algorandRows(): Promise<{ rows: TxRow[]; stat: BotStat }> {
  const addr = ledgerAddress();
  if (!addr) return { rows: [], stat: { actions: 0, last: null } };
  const [preds, joins] = await Promise.all([readStamps(addr, 1000), readJoins()]);
  const rows: TxRow[] = [
    ...preds.map((s): TxRow => ({
      id: s.txId, chain: "Algorand", kind: "prediction", title: "Prediction locked", detail: `Open of ${s.session}: ${Object.entries(s.p).map(([t, v]) => `${t} ${v.toFixed(2)}`).join(", ")}`,
      actor: addr, actorUrl: `https://lora.algokit.io/testnet/account/${addr}`, bot: "ledger", at: s.roundTime, href: explorerTx(s.txId),
    })),
    ...joins.map((j): TxRow => ({
      id: j.txId, chain: "Algorand", kind: "join", title: "Joined the leaderboard", detail: `${short(j.address)} signed up`,
      actor: j.address, actorUrl: addrUrl(j.address), bot: null, at: j.at, href: explorerTx(j.txId),
    })),
  ];
  // the stamping account sends both kinds, so it is credited with all of them
  const last = rows.reduce((m, r) => Math.max(m, r.at), 0);
  return { rows, stat: { actions: rows.length, last: last || null } };
}

let cache: { at: number; data: Transactions } | null = null;
const TTL_MS = 60_000;

export async function getTransactions(): Promise<Transactions> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const [baseRes, algoRes] = await Promise.allSettled([baseRows(), algorandRows()]);
  const base = baseRes.status === "fulfilled" ? baseRes.value : null;
  const algo = algoRes.status === "fulfilled" ? algoRes.value : null;
  const every = [...(base?.rows ?? []), ...(algo?.rows ?? [])].sort((a, b) => b.at - a.at);
  const rows = every.slice(0, FEED_LIMIT);
  const flows: Transactions["flows"] = {};
  for (const r of every) {
    const f = flows[r.kind];
    if (f) f.count++;
    else flows[r.kind] = { count: 1, latest: { id: r.id, at: r.at, href: r.href, chain: r.chain } }; // newest first, so the first seen is the latest
  }
  const none: BotStat = { actions: 0, last: null };
  const data: Transactions = {
    updatedAt: new Date().toISOString(),
    rows,
    bots: { updater: base?.bots.updater ?? none, keeper: base?.bots.keeper ?? none, faucet: base?.bots.faucet ?? none, ledger: algo?.stat ?? none },
    flows,
    baseSince: base?.since ?? null,
    sources: { base: base ? "ok" : "unavailable", algorand: algo ? "ok" : "unavailable" },
  };
  if (base && algo) cache = { at: Date.now(), data };
  return data;
}

export function invalidateTransactions() {
  cache = null;
}
