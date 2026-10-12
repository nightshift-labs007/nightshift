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
