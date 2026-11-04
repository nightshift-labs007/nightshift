import "server-only";
import { createHash } from "crypto";
import { createPublicClient, createWalletClient, hexToString, isHex, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DEPLOYMENT, addrUrl, chainOf, chainTransport, isDeployed, txUrl } from "@/lib/chain";
import { kvEnabled, kvHGetAll, kvHSet, kvHSetNX } from "@/lib/kv";

/**
 * Nightshift's public record, on Base. Each entry is a 0-ETH transaction from the ledger wallet to itself whose input
 * data is the note in plain text (Basescan shows it under "Input Data → UTF-8"), so a call or a sign-up is fixed in time
 * and can't be edited, including by us. A Redis index lists them quickly; every listed entry links to its transaction.
 *   - pre-open calls:       nightshift:v1:{session, at, p, c, h}
 *   - evening calls:        nightshift:eve:v1:{…}   (the strike of the "Call the Open" rounds)
 *   - leaderboard sign-ups: nsjoin:v1:{a}
 * The ledger wallet is the Oracle updater role (ORACLE_UPDATER_PRIVATE_KEY).
 */
export const NOTE_PREFIX = "nightshift:v1:";
export const EVENING_PREFIX = "nightshift:eve:v1:";
export const JOIN_PREFIX = "nsjoin:v1:";

const STAMPS = "ledger:stamps"; // tx hash → StampedPrediction JSON (with its prefix)
const JOINS = "ledger:joins"; // address → Join JSON (the first sign-up only)

export const explorerTx = (hash: string) => txUrl(hash);
export const explorerAccount = (address: string) => addrUrl(address);

export type Prediction = {
  session: string; // target open, YYYY-MM-DD (New York)
  at: string; // when it was locked
  p: Record<string, number>; // fair values
  c: Record<string, number>; // confidence
};
export type StampedPrediction = Prediction & { h: string; txId: string; round: number; roundTime: number; prefix?: string };
export type Join = { address: string; at: number; txId: string };

export function hashPrediction(pred: Prediction) {
  return createHash("sha256").update(JSON.stringify(pred)).digest("hex");
}

function account() {
  const key = process.env.ORACLE_UPDATER_PRIVATE_KEY?.trim();
  return key && /^0x[0-9a-fA-F]{64}$/.test(key) && isDeployed ? privateKeyToAccount(key as Hex) : null;
}

export function ledgerAddress(): string | null {
  return account()?.address ?? null;
}

/** Writes a note on Base (a 0-ETH self-transaction) and waits for it. Retries once on a nonce clash with other jobs. */
async function writeNote(note: string): Promise<{ hash: Hex; block: number; time: number }> {
  const acct = account();
  if (!acct) throw new Error("ledger wallet (ORACLE_UPDATER_PRIVATE_KEY) not configured");
  const chain = chainOf();
  const transport = chainTransport();
  const pub = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ chain, transport, account: acct });
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const nonce = await pub.getTransactionCount({ address: acct.address, blockTag: "pending" });
      const hash = await wallet.sendTransaction({ to: acct.address as Address, value: 0n, data: toHex(note), nonce });
      const r = await pub.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error(`ledger transaction failed: ${hash}`);
      const block = await pub.getBlock({ blockNumber: r.blockNumber });
      return { hash, block: Number(r.blockNumber), time: Number(block.timestamp) };
    } catch (e) {
      lastErr = e;
      if (!/nonce|replacement|underpriced/i.test(String(e))) break;
      await new Promise((res) => setTimeout(res, 1500));
    }
  }
  throw lastErr;
}

/** Locks a prediction on Base. Returns the transaction hash. */
export async function stampPrediction(pred: Prediction, prefix = NOTE_PREFIX): Promise<{ txId: string; hash: string }> {
  const h = hashPrediction(pred);
  const { hash, block, time } = await writeNote(prefix + JSON.stringify({ ...pred, h }));
  const entry: StampedPrediction = { ...pred, h, txId: hash, round: block, roundTime: time, prefix };
  if (kvEnabled()) await kvHSet(STAMPS, hash, JSON.stringify(entry)).catch(() => {});
  return { txId: hash, hash: h };
}

/** Our recorded calls, newest first (from the index; each one links to its Base transaction). */
export async function readStamps(_addr?: string, limit = 15, notePrefix = NOTE_PREFIX): Promise<StampedPrediction[]> {
  if (!kvEnabled()) return [];
  const all = Object.values(await kvHGetAll(STAMPS))
    .map((v) => {
      try {
        return JSON.parse(v) as StampedPrediction;
      } catch {
        return null;
      }
    })
    .filter((s): s is StampedPrediction => !!s && (s.prefix ?? NOTE_PREFIX) === notePrefix);
  return all.sort((a, b) => b.roundTime - a.roundTime).slice(0, limit);
}

/** Records that `address` signed up (and so joined the leaderboard), once per address. Returns the transaction hash. */
export async function recordJoin(address: string): Promise<string> {
  const a = address.toLowerCase();
  const { hash, time } = await writeNote(JOIN_PREFIX + JSON.stringify({ a }));
  if (kvEnabled()) await kvHSetNX(JOINS, a, JSON.stringify({ address: a, at: time, txId: hash } satisfies Join)).catch(() => {});
  return hash;
}

/** Every leaderboard sign-up recorded on Base, oldest first, one per address. */
export async function readJoins(): Promise<Join[]> {
  if (!kvEnabled()) return [];
  return Object.values(await kvHGetAll(JOINS))
    .map((v) => {
      try {
        return JSON.parse(v) as Join;
      } catch {
        return null;
      }
    })
    .filter((j): j is Join => !!j)
    .sort((x, y) => x.at - y.at);
}

/** Reads a ledger note back from its Base transaction (for anyone checking an entry). */
export async function readNote(hash: Hex): Promise<string | null> {
  if (!isDeployed) return null;
  const pub = createPublicClient({ chain: chainOf(), transport: chainTransport() });
  const tx = await pub.getTransaction({ hash }).catch(() => null);
  if (!tx?.input || !isHex(tx.input) || tx.input === "0x") return null;
  return hexToString(tx.input);
}

export const LEDGER_CHAIN = DEPLOYMENT.chainName;
