// Deploys NightshiftPredictions ("Call the Open") to the live deployment in lib/chain/deployment.json, Base Sepolia or Base
// mainnet (stakes are the deployment's test/demo USDG, no value):
//   1. NightshiftPredictions(tUSDG, keeper): the keeper is the operator (creates rounds, proposes results, syncs members)
//   2. Pyth feed ids for the five ETFs are recorded (the Pyth path stays off until setPyth is called with a key in place)
//   3. records the address in lib/chain/deployment.json ("predictions")
//
//   node --env-file=.env.local scripts/deploy-predictions.mjs     (needs DEPLOYER_PRIVATE_KEY, the deployment's owner)
import fs from "node:fs";
import { createPublicClient, createWalletClient, formatEther, http, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

const D = JSON.parse(fs.readFileSync("lib/chain/deployment.json", "utf8"));
const RPC_URL = process.env.RPC_URL || (D.chainId === 8453 ? "https://mainnet.base.org" : "https://sepolia.base.org");
const A = JSON.parse(fs.readFileSync("lib/chain/artifacts.json", "utf8"));
if (D.chainId !== 84532 && D.chainId !== 8453) throw new Error("deployment.json is neither Base Sepolia nor Base mainnet");
if (D.predictions) throw new Error("Predictions are already deployed (deployment.json has a predictions section)");

// Pyth Equity.US.<TICKER>/USD feeds (regular hours), checked against hermes.pyth.network on 2026-11-04
const PYTH_FEEDS = {
  SPY: "0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5",
  QQQ: "0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d",
  GLD: "0xe190f467043db04548200354889dfe0d9d314c08b8d4e62fabf4d5a3140fecca",
  SLV: "0x6fc08c9963d266069cbd9780d98383dabf2668322a5bef0b9491e11d67e5d7e7",
  IBIT: "0x9db6bc1e6e9e5e60f6884e1cd8e4399cca9d0454c6e7234ad79680cf139748f5",
};
// the Pyth contract on each chain (the Pyth path stays off until setPyth is called)
const PYTH = D.chainId === 8453 ? "0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a" : "0xA2aa501b19aff244D90cc15a4Cf739D2725B5729";

const chain = { ...(D.chainId === 8453 ? base : baseSepolia), rpcUrls: { default: { http: [RPC_URL] } } };
const transport = http(RPC_URL, { retryCount: 4, retryDelay: 1500 });
const pub = createPublicClient({ chain, transport });
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY.trim());
const owner = createWalletClient({ chain, transport, account });
if (account.address.toLowerCase() !== D.owner.toLowerCase()) throw new Error("DEPLOYER_PRIVATE_KEY is not the owner in deployment.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nonce = await pub.getTransactionCount({ address: account.address, blockTag: "pending" });
const before = await pub.getBalance({ address: account.address });
console.log(`owner ${account.address}: ${formatEther(before)} ETH`);
async function send(label, address, fn, args) {
  const hash = await owner.writeContract({ address, abi: A.NightshiftPredictions.abi, functionName: fn, args, nonce: nonce++ });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} failed: ${hash}`);
  console.log(`  ${label}`);
  await sleep(3000); // public RPCs are load-balanced: let every node see this transaction first
}

console.log("Deploying:");
const hash = await owner.deployContract({ abi: A.NightshiftPredictions.abi, bytecode: A.NightshiftPredictions.bytecode, args: [D.contracts.usdg, D.roles.keeper], nonce: nonce++ });
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error(`deploy failed: ${hash}`);
const address = receipt.contractAddress;
console.log(`  NightshiftPredictions           ${address}`);
await sleep(3000);

console.log("Configuring:");
for (const [sym, feed] of Object.entries(PYTH_FEEDS)) await send(`Pyth feed ${sym}`, address, "setPythFeed", [toHex(sym, { size: 8 }), feed]);
console.log(`owner spent ${formatEther(before - (await pub.getBalance({ address: account.address })))} ETH`);

fs.writeFileSync(
  "lib/chain/deployment.json",
  JSON.stringify({ ...D, predictions: { address, deployedAt: new Date().toISOString(), startBlock: Number(receipt.blockNumber), pyth: PYTH, pythFeeds: PYTH_FEEDS } }, null, 2) + "\n",
);
console.log("wrote lib/chain/deployment.json");
