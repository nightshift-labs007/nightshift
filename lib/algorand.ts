import algosdk from "algosdk";
import { createHash } from "crypto";

const ALGOD = "https://testnet-api.algonode.cloud";
const INDEXER = "https://testnet-idx.algonode.cloud";
export const NOTE_PREFIX = "nightshift:v1:";

export const explorerTx = (id: string) => `https://lora.algokit.io/testnet/transaction/${id}`;
export const explorerAccount = (addr: string) => `https://lora.algokit.io/testnet/account/${addr}`;

export type Prediction = {
  session: string; // target open, YYYY-MM-DD (New York)
  at: string; // when it was locked
  p: Record<string, number>; // fair values
  c: Record<string, number>; // confidence
};

export function hashPrediction(pred: Prediction) {
  return createHash("sha256").update(JSON.stringify(pred)).digest("hex");
}

function account() {
  const mn = process.env.ALGORAND_MNEMONIC?.trim();
  return mn ? algosdk.mnemonicToSecretKey(mn) : null;
}

export function ledgerAddress(): string | null {
  return account()?.addr.toString() ?? null;
}

/** Writes the prediction into a 0-ALGO self-payment note on TestNet. Returns the tx id. */
export async function stampPrediction(pred: Prediction): Promise<{ txId: string; hash: string }> {
  const acct = account();
  if (!acct) throw new Error("ALGORAND_MNEMONIC not configured");
  const hash = hashPrediction(pred);
  const algod = new algosdk.Algodv2("", ALGOD, "");
  const suggestedParams = await algod.getTransactionParams().do();
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: acct.addr,
    receiver: acct.addr,
    amount: 0,
    note: new TextEncoder().encode(NOTE_PREFIX + JSON.stringify({ ...pred, h: hash })),
    suggestedParams,
  });
  const { txid } = await algod.sendRawTransaction(txn.signTxn(acct.sk)).do();
  await algosdk.waitForConfirmation(algod, txid, 4);
  return { txId: txid, hash };
}

export type StampedPrediction = Prediction & { h: string; txId: string; round: number; roundTime: number };

/** The ledger doubles as the database: read our own past stamps back from the indexer. */
export async function readStamps(addr: string, limit = 15): Promise<StampedPrediction[]> {
  const prefix = Buffer.from(NOTE_PREFIX).toString("base64");
  const url = `${INDEXER}/v2/accounts/${addr}/transactions?note-prefix=${encodeURIComponent(prefix)}&limit=${limit}`;
  const res = await fetch(url, { next: { revalidate: 60 }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`indexer ${res.status}`);
  const json = await res.json();
  const out: StampedPrediction[] = [];
  for (const tx of json.transactions ?? []) {
    try {
      const note = Buffer.from(tx.note, "base64").toString("utf8");
      if (!note.startsWith(NOTE_PREFIX)) continue;
      const body = JSON.parse(note.slice(NOTE_PREFIX.length));
      out.push({ ...body, txId: tx.id, round: tx["confirmed-round"], roundTime: tx["round-time"] });
    } catch {
      // ignore malformed notes
    }
  }
  return out.sort((a, b) => b.roundTime - a.roundTime);
}

// ---------------------------------------------------------------- leaderboard joins
// A separate note prefix, so joins never mix with the prediction stamps above.
export const JOIN_PREFIX = "nsjoin:v1:";
export type Join = { address: string; at: number; txId: string };

/** Records that `address` joined the public leaderboard (it signed for it) as a 0-ALGO self-payment note. */
export async function recordJoin(address: string): Promise<string> {
  const acct = account();
  if (!acct) throw new Error("ALGORAND_MNEMONIC not configured");
  const algod = new algosdk.Algodv2("", ALGOD, "");
  const suggestedParams = await algod.getTransactionParams().do();
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: acct.addr,
    receiver: acct.addr,
    amount: 0,
    note: new TextEncoder().encode(JOIN_PREFIX + JSON.stringify({ a: address.toLowerCase() })),
    suggestedParams,
  });
  const { txid } = await algod.sendRawTransaction(txn.signTxn(acct.sk)).do();
  await algosdk.waitForConfirmation(algod, txid, 4);
  return txid;
}

/** Every leaderboard join recorded on Algorand, oldest first, one per address. */
export async function readJoins(max = 5000): Promise<Join[]> {
  const addr = ledgerAddress();
  if (!addr) return [];
  const prefix = encodeURIComponent(Buffer.from(JOIN_PREFIX).toString("base64"));
  const seen = new Map<string, Join>();
  let next = "";
  for (let fetched = 0; fetched < max; ) {
    const url = `${INDEXER}/v2/accounts/${addr}/transactions?note-prefix=${prefix}&limit=1000${next ? `&next=${next}` : ""}`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`indexer ${res.status}`);
    const json = await res.json();
    const txs = json.transactions ?? [];
    for (const tx of txs) {
      try {
        const body = JSON.parse(Buffer.from(tx.note, "base64").toString("utf8").slice(JOIN_PREFIX.length));
        const a = String(body.a ?? "").toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(a)) continue;
        const j = { address: a, at: tx["round-time"], txId: tx.id };
        const prev = seen.get(a);
        if (!prev || j.at < prev.at) seen.set(a, j);
      } catch {
        // ignore malformed notes
      }
    }
    fetched += txs.length;
    next = json["next-token"] ?? "";
    if (!next || !txs.length) break;
  }
  return [...seen.values()].sort((x, y) => x.at - y.at);
}
