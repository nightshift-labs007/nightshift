import "server-only";
import algosdk from "algosdk";
import record from "./algorand-testnet.json";
import type { Quote } from "./oracle";

/**
 * The Nightshift Oracle on Algorand TestNet (algorand/contracts/oracle.py). The keeper pushes the off-chain fair values
 * here; the site reads them back from the app's global state. Prices are micro-USD (6 decimals).
 */

const ALGOD = "https://testnet-api.algonode.cloud";
type OracleRecord = { appId: number; appAddress: string; owner: string; updater: string; createTx: string; createdAt: string; maxMoveBps: number };
export const ALGO_ORACLE = (record as { oracle?: OracleRecord }).oracle ?? null;
export const algoAppUrl = (id: number) => `https://lora.algokit.io/testnet/application/${id}`;
export const algoTxUrl = (id: string) => `https://lora.algokit.io/testnet/transaction/${id}`;

const PER_CALL = 3;
const SET_PRICES = new algosdk.ABIMethod({
  name: "set_prices",
  args: [{ type: "string[]" }, { type: "uint64[]" }, { type: "uint8[]" }],
  returns: { type: "uint64" },
});

function updater() {
  const mn = process.env.ALGORAND_ORACLE_MNEMONIC?.trim();
  return mn ? algosdk.mnemonicToSecretKey(mn) : null;
}

/** Pushes fair values and confidences in one app call. Skipped moves (over the 15% limit) are reported back. */
export async function pushAlgorandPrices(quotes: Quote[]): Promise<{ txId: string; written: number; of: number } | null> {
  const acct = updater();
  if (!ALGO_ORACLE || !acct) return null;
  const live = quotes.filter((q) => q.source === "live" && q.fairValue > 0);
  if (!live.length) return null;
  const algod = new algosdk.Algodv2("", ALGOD, "");
  const suggestedParams = await algod.getTransactionParams().do();
  // An app call may spend 700 opcode units and each symbol costs ~150 (measured with simulate), so prices go in
  // chunks of PER_CALL inside one atomic group, whose calls pool their budgets: all are written or none are.
  const atc = new algosdk.AtomicTransactionComposer();
  for (let i = 0; i < live.length; i += PER_CALL) {
    const part = live.slice(i, i + PER_CALL);
    atc.addMethodCall({
      appID: ALGO_ORACLE.appId,
      method: SET_PRICES,
      methodArgs: [part.map((q) => q.token), part.map((q) => BigInt(Math.round(q.fairValue * 1e6))), part.map((q) => Math.max(0, Math.min(100, Math.round(q.confidence))))],
      sender: acct.addr,
      signer: algosdk.makeBasicAccountTransactionSigner(acct),
      suggestedParams,
      note: new TextEncoder().encode(`nightshift:prices:v1:${i / PER_CALL}`),
    });
  }
  const res = await atc.execute(algod, 4);
  return { txId: res.txIDs[0], written: res.methodResults.reduce((a, r) => a + Number(r.returnValue ?? 0), 0), of: live.length };
}

export type AlgoFeed = { symbol: string; price: number; confidence: number; updatedAt: number };

const toBytes = (v: Uint8Array | string) => (typeof v === "string" ? new Uint8Array(Buffer.from(v, "base64")) : v);

/** Every feed stored in the Oracle app's global state (key "p:" + symbol, value price | confidence | time). */
export async function readAlgorandFeeds(): Promise<AlgoFeed[] | null> {
  if (!ALGO_ORACLE) return null;
  const algod = new algosdk.Algodv2("", ALGOD, "");
  const app = await algod.getApplicationByID(ALGO_ORACLE.appId).do();
  const out: AlgoFeed[] = [];
  for (const kv of app.params?.globalState ?? []) {
    const key = Buffer.from(toBytes(kv.key as Uint8Array | string)).toString("utf8");
    if (!key.startsWith("p:")) continue;
    const v = Buffer.from(toBytes(kv.value.bytes as Uint8Array | string));
    if (v.length !== 17) continue;
    out.push({ symbol: key.slice(2), price: Number(v.readBigUInt64BE(0)) / 1e6, confidence: v[8], updatedAt: Number(v.readBigUInt64BE(9)) });
  }
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
}
