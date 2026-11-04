// Deploys NightshiftPredictions ("Call the Open") to the live deployment in lib/chain/deployment.json, Base Sepolia or Base
// mainnet:
//   1. NightshiftPredictions(stake token, keeper): the keeper is the operator (creates rounds, proposes results, syncs members)
//   2. Pyth feed ids for the five ETFs are recorded (the Pyth path stays off until setPyth is called with a key in place)
//   3. with real USDC: small caps per prediction and per wallet per round
//   4. records the address and the stake token in lib/chain/deployment.json ("predictions")
//
//   node --env-file=.env.local scripts/deploy-predictions.mjs     (demo USDG stakes; needs DEPLOYER_PRIVATE_KEY, the owner)
//   STAKE=usdc REPLACE=1 node --env-file=.env.local scripts/deploy-predictions.mjs   (Base mainnet: real USDC stakes, small
//     caps; replaces the deployed predictions contract, which is kept under predictionsPrevious)
//   RPC_URL=http://127.0.0.1:8546 DRY_RUN=1 …   (rehearsal on a fork: nothing is written)
import fs from "node:fs";
import { createPublicClient, createWalletClient, formatEther, http, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

const D = JSON.parse(fs.readFileSync("lib/chain/deployment.json", "utf8"));
const RPC_URL = process.env.RPC_URL || (D.chainId === 8453 ? "https://mainnet.base.org" : "https://sepolia.base.org");
const A = JSON.parse(fs.readFileSync("lib/chain/artifacts.json", "utf8"));
if (D.chainId !== 84532 && D.chainId !== 8453) throw new Error("deployment.json is neither Base Sepolia nor Base mainnet");
if (D.predictions && process.env.REPLACE !== "1") throw new Error("Predictions are already deployed (set REPLACE=1 to replace them)");
const DRY_RUN = process.env.DRY_RUN === "1";
// what people stake: the deployment's demo USDG (no value), or real USDC on Base mainnet with small caps
const USDC = process.env.STAKE === "usdc";
if (USDC && D.chainId !== 8453) throw new Error("USDC stakes are for Base mainnet");
const STAKE = USDC
  ? { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6, real: true, maxBet: 10_000_000n, maxPerWallet: 25_000_000n }
  : { address: D.contracts.usdg, symbol: `${D.symbolPrefix ?? "d"}USDG`, decimals: 18, real: false };

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
const account = DRY_RUN ? D.owner : privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY.trim());
const ownerAddr = DRY_RUN ? D.owner : account.address;
const owner = createWalletClient({ chain, transport, account });
if (ownerAddr.toLowerCase() !== D.owner.toLowerCase()) throw new Error("DEPLOYER_PRIVATE_KEY is not the owner in deployment.json");
if (DRY_RUN) {
  await pub.request({ method: "hardhat_impersonateAccount", params: [D.owner] });
  await pub.request({ method: "hardhat_setBalance", params: [D.owner, "0x56BC75E2D63100000"] });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nonce = await pub.getTransactionCount({ address: ownerAddr, blockTag: "pending" });
const before = await pub.getBalance({ address: ownerAddr });
console.log(`owner ${ownerAddr}: ${formatEther(before)} ETH${DRY_RUN ? " (rehearsal)" : ""}`);
async function send(label, address, fn, args) {
  const hash = await owner.writeContract({ address, abi: A.NightshiftPredictions.abi, functionName: fn, args, nonce: nonce++ });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} failed: ${hash}`);
  console.log(`  ${label}`);
  if (!DRY_RUN) await sleep(3000); // public RPCs are load-balanced: let every node see this transaction first
}

console.log(`Deploying (stakes in ${STAKE.symbol}):`);
const hash = await owner.deployContract({ abi: A.NightshiftPredictions.abi, bytecode: A.NightshiftPredictions.bytecode, args: [STAKE.address, D.roles.keeper], nonce: nonce++ });
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error(`deploy failed: ${hash}`);
const address = receipt.contractAddress;
console.log(`  NightshiftPredictions           ${address}`);
if (!DRY_RUN) await sleep(3000);

console.log("Configuring:");
for (const [sym, feed] of Object.entries(PYTH_FEEDS)) await send(`Pyth feed ${sym}`, address, "setPythFeed", [toHex(sym, { size: 8 }), feed]);
// small stakes for real money: caps per prediction and per wallet per round; same 2h challenge window, 24h cancel, 50% late weight
if (STAKE.maxBet)
  await send(`caps: ${Number(STAKE.maxBet) / 10 ** STAKE.decimals} ${STAKE.symbol} per prediction, ${Number(STAKE.maxPerWallet) / 10 ** STAKE.decimals} per round`, address, "setLimits", [STAKE.maxBet, STAKE.maxPerWallet, 7200n, 86400n, 5000]);
console.log(`owner spent ${formatEther(before - (await pub.getBalance({ address: ownerAddr })))} ETH`);

const stake = { address: STAKE.address, symbol: STAKE.symbol, decimals: STAKE.decimals, real: STAKE.real };
const next = { ...D, predictions: { address, deployedAt: new Date().toISOString(), startBlock: Number(receipt.blockNumber), pyth: PYTH, pythFeeds: PYTH_FEEDS, stake } };
if (D.predictions) next.predictionsPrevious = [...(D.predictionsPrevious ?? []), { address: D.predictions.address, retiredAt: new Date().toISOString() }];
if (DRY_RUN) console.log("rehearsal: deployment.json not changed", address);
else {
  fs.writeFileSync("lib/chain/deployment.json", JSON.stringify(next, null, 2) + "\n");
  console.log("wrote lib/chain/deployment.json");
}
