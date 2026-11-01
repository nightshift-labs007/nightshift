// Deploys NightshiftOracle (algorand/contracts/oracle.py, compiled to algorand/artifacts) to Algorand TestNet.
// Usage: node --env-file=.env.local scripts/algo-deploy-oracle.mjs
// The account in ALGORAND_ORACLE_MNEMONIC becomes the owner and the price updater. Writes lib/algorand-testnet.json.
import algosdk from "algosdk";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ART = path.join(ROOT, "algorand", "artifacts");
const OUT = path.join(ROOT, "lib", "algorand-testnet.json");
const ALGOD = "https://testnet-api.algonode.cloud";
const TESTNET_GENESIS = "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI="; // refuse to run anywhere but TestNet

const mn = process.env.ALGORAND_ORACLE_MNEMONIC?.trim();
if (!mn) throw new Error("Set ALGORAND_ORACLE_MNEMONIC in .env.local");
const acct = algosdk.mnemonicToSecretKey(mn);
const algod = new algosdk.Algodv2("", ALGOD, "");

const params = await algod.getTransactionParams().do();
if (params.genesisHash && Buffer.from(params.genesisHash).toString("base64") !== TESTNET_GENESIS) throw new Error("Not Algorand TestNet: refusing to deploy");

const record = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { network: "testnet" };
if (record.oracle?.appId && !process.argv.includes("--force")) {
  console.log(`Oracle already deployed: app ${record.oracle.appId}. Pass --force to deploy a new one.`);
  process.exit(0);
}

const spec = JSON.parse(fs.readFileSync(path.join(ART, "NightshiftOracle.arc56.json"), "utf8"));
const { ints, bytes } = spec.state.schema.global;
// the creator's minimum balance rises by 0.1 ALGO per app plus the global schema; keep a little for fees
const needed = 100_000 + ints * 28_500 + bytes * 50_000 + 100_000 + 200_000;
const info = await algod.accountInformation(acct.addr).do();
const balance = Number(info.amount);
console.log(`Deployer ${acct.addr} · balance ${(balance / 1e6).toFixed(3)} ALGO · needs about ${(needed / 1e6).toFixed(3)} ALGO`);
if (balance < needed) {
  console.log(`Fund it at https://lora.algokit.io/testnet/fund, then run this again.`);
  process.exit(2);
}

const txn = algosdk.makeApplicationCreateTxnFromObject({
  sender: acct.addr,
  suggestedParams: params,
  onComplete: algosdk.OnApplicationComplete.NoOpOC,
  approvalProgram: new Uint8Array(fs.readFileSync(path.join(ART, "NightshiftOracle.approval.bin"))),
  clearProgram: new Uint8Array(fs.readFileSync(path.join(ART, "NightshiftOracle.clear.bin"))),
  numGlobalInts: ints,
  numGlobalByteSlices: bytes,
  numLocalInts: 0,
  numLocalByteSlices: 0,
  note: new TextEncoder().encode("nightshift:oracle:v1"),
});
const { txid } = await algod.sendRawTransaction(txn.signTxn(acct.sk)).do();
const result = await algosdk.waitForConfirmation(algod, txid, 6);
const appId = Number(result.applicationIndex);

record.oracle = {
  appId,
  appAddress: algosdk.getApplicationAddress(appId).toString(),
  owner: acct.addr.toString(),
  updater: acct.addr.toString(),
  createTx: txid,
  createdAt: new Date().toISOString(),
  priceDecimals: 6,
  maxMoveBps: 1500,
};
fs.writeFileSync(OUT, JSON.stringify(record, null, 2) + "\n");
console.log(`Deployed NightshiftOracle: app ${appId}`);
console.log(`  https://lora.algokit.io/testnet/application/${appId}`);
console.log(`  wrote ${path.relative(ROOT, OUT)}`);
