// Deploys Nightshift Stack to the live Base deployment (demo tokens, no value):
//   1. StackDemoPool: sells dGLD and dSLV for dUSDG at the Oracle price plus a spread (stand-in for a DEX pool)
//   2. StackPlan: the recurring-buy contract (the allowlist, limits and venue are set here)
//   3. seeds the pool with inventory and records the addresses in lib/chain/deployment.json ("stack")
//
//   DRY_RUN=1 RPC_URL=http://127.0.0.1:8546 node scripts/deploy-stack.mjs     (rehearsal on a fork: no key, nothing written)
//   node --env-file=.env.local scripts/deploy-stack.mjs                       (Base mainnet; needs DEPLOYER_PRIVATE_KEY)
import fs from "node:fs";
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const DRY_RUN = process.env.DRY_RUN === "1";
const D = JSON.parse(fs.readFileSync("lib/chain/deployment.json", "utf8"));
const A = JSON.parse(fs.readFileSync("lib/chain/artifacts.json", "utf8"));
if (D.chainId !== 8453) throw new Error("deployment.json is not the Base mainnet deployment");
if (D.stack) throw new Error("Stack is already deployed (deployment.json has a stack section)");
const ASSETS = [
  { sym: "GLD", capBps: 50, inventory: "2000" }, // plans may allow at most +0.50% over fair value
  { sym: "SLV", capBps: 75, inventory: "20000" }, // silver gaps harder and its pools are thinner: +0.75%
];

const chain = { ...base, rpcUrls: { default: { http: [RPC_URL] } } };
const transport = http(RPC_URL, { retryCount: 4, retryDelay: 1500 });
const pub = createPublicClient({ chain, transport });
const account = DRY_RUN ? D.owner : privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY.trim());
const owner = createWalletClient({ chain, transport, account });
const ownerAddr = DRY_RUN ? D.owner : account.address;
if (ownerAddr.toLowerCase() !== D.owner.toLowerCase()) throw new Error("DEPLOYER_PRIVATE_KEY is not the owner in deployment.json");
if (DRY_RUN) {
  await pub.request({ method: "hardhat_impersonateAccount", params: [D.owner] });
  await pub.request({ method: "hardhat_setBalance", params: [D.owner, "0x56BC75E2D63100000"] });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nonce = await pub.getTransactionCount({ address: ownerAddr, blockTag: "pending" });
const before = await pub.getBalance({ address: ownerAddr });
console.log(`owner ${ownerAddr}: ${formatEther(before)} ETH${DRY_RUN ? " (rehearsal)" : ""}`);
async function deploy(label, name, args) {
  const hash = await owner.deployContract({ abi: A[name].abi, bytecode: A[name].bytecode, args, nonce: nonce++ });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} failed: ${hash}`);
  console.log(`  ${label.padEnd(30)} ${r.contractAddress}`);
  await sleep(3500); // public RPCs are load-balanced: let every node see this transaction before the next call
  return r.contractAddress;
}
async function send(label, address, name, fn, args) {
  const hash = await owner.writeContract({ address, abi: A[name].abi, functionName: fn, args, nonce: nonce++ });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} failed: ${hash}`);
  console.log(`  ${label}`);
  await sleep(3500);
}

const { usdg, oracle } = D.contracts;
console.log("Deploying:");
const pool = await deploy("StackDemoPool", "StackDemoPool", [usdg, oracle]);
const plan = await deploy("StackPlan", "StackPlan", [usdg, oracle, pool]);

console.log("Configuring:");
for (const a of ASSETS) {
  const token = D.tokens[a.sym]?.address;
  if (!token) throw new Error(`${a.sym} is not in deployment.json`);
  await send(`allow ${a.sym} (premium cap ${a.capBps / 100}%)`, plan, "StackPlan", "setAsset", [token, true, a.capBps]);
  await send(`pool spread ${a.sym}: 0 (fair value)`, pool, "StackDemoPool", "setSpread", [token, 0n]);
  await send(`pool inventory: ${a.inventory} d${a.sym}`, token, "TestToken", "mint", [pool, parseEther(a.inventory)]);
}
console.log(`limits: min interval ${await pub.readContract({ address: plan, abi: A.StackPlan.abi, functionName: "minInterval" })}s, per-run ${formatEther(await pub.readContract({ address: plan, abi: A.StackPlan.abi, functionName: "maxPerRun" }))} dUSDG`);
console.log(`owner spent ${formatEther(before - (await pub.getBalance({ address: ownerAddr })))} ETH`);

if (DRY_RUN) console.log("rehearsal: deployment.json not changed");
else {
  fs.writeFileSync("lib/chain/deployment.json", JSON.stringify({ ...D, stack: { plan, pool, deployedAt: new Date().toISOString() } }, null, 2) + "\n");
  console.log("wrote lib/chain/deployment.json");
}
