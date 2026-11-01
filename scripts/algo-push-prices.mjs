// Pushes the current Oracle fair values to the Algorand TestNet Oracle once, from a running site's /api/oracle.
// Usage: node --env-file=.env.local scripts/algo-push-prices.mjs [http://localhost:3100]
// (In production the keeper does this: /api/keeper.)
import algosdk from "algosdk";
import fs from "node:fs";

const base = process.argv[2] ?? "http://localhost:3100";
const rec = JSON.parse(fs.readFileSync(new URL("../lib/algorand-testnet.json", import.meta.url), "utf8"));
if (!rec.oracle?.appId) throw new Error("Deploy the Oracle first: scripts/algo-deploy-oracle.mjs");
const acct = algosdk.mnemonicToSecretKey(process.env.ALGORAND_ORACLE_MNEMONIC.trim());
const snap = await (await fetch(`${base}/api/oracle`)).json();
const live = snap.quotes.filter((q) => q.source === "live");
const algod = new algosdk.Algodv2("", "https://testnet-api.algonode.cloud", "");
const method = new algosdk.ABIMethod({ name: "set_prices", args: [{ type: "string[]" }, { type: "uint64[]" }, { type: "uint8[]" }], returns: { type: "uint64" } });
// 3 symbols per app call (700-unit opcode budget, ~150 per symbol), all calls in one atomic group
const PER_CALL = 3;
const suggestedParams = await algod.getTransactionParams().do();
const atc = new algosdk.AtomicTransactionComposer();
for (let i = 0; i < live.length; i += PER_CALL) {
  const part = live.slice(i, i + PER_CALL);
  atc.addMethodCall({
    appID: rec.oracle.appId,
    method,
    methodArgs: [part.map((q) => q.token), part.map((q) => BigInt(Math.round(q.fairValue * 1e6))), part.map((q) => Math.round(q.confidence))],
    sender: acct.addr,
    signer: algosdk.makeBasicAccountTransactionSigner(acct),
    suggestedParams,
    note: new TextEncoder().encode(`nightshift:prices:v1:${i / PER_CALL}`),
  });
}
const res = await atc.execute(algod, 4);
const written = res.methodResults.reduce((a, r) => a + Number(r.returnValue ?? 0), 0);
console.log(`Pushed ${written} of ${live.length} prices in ${res.txIDs.length} grouped calls · https://lora.algokit.io/testnet/transaction/${res.txIDs[0]}`);
for (const q of live) console.log(`  ${q.token.padEnd(5)} $${q.fairValue.toFixed(2)} conf ${q.confidence}`);
