// Adds the silver demo token (dSLV) to the live Base deployment, leaving everything else untouched:
//   1. deploys the dSLV token, its Morpho oracle adapter and its Chainlink-style feed (owner wallet)
//   2. lets the faucet wallet mint it, and switches on the Vault market at LLTV 62.5%
//   3. writes a first Oracle price (owner override) so the adapter and the Morpho market can be created straight away
//   4. records the addresses in lib/chain/deployment.json
// Then run `EXECUTE=1 node --env-file=.env.local scripts/create-morpho-markets.mjs` to create and seed the Morpho market.
//
//   DRY_RUN=1 RPC_URL=http://127.0.0.1:8546 node scripts/deploy-slv.mjs      (rehearsal on a fork: no keys, nothing written)
//   node --env-file=.env.local scripts/deploy-slv.mjs                        (Base mainnet; needs DEPLOYER_PRIVATE_KEY)
import fs from "node:fs";
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const DRY_RUN = process.env.DRY_RUN === "1";
const SYM = "SLV";
const LLTV = "0.625"; // from public/verified/lltv-study.json
const D = JSON.parse(fs.readFileSync("lib/chain/deployment.json", "utf8"));
const A = JSON.parse(fs.readFileSync("lib/chain/artifacts.json", "utf8"));
if (D.chainId !== 8453) throw new Error("deployment.json is not the Base mainnet deployment");
if (D.tokens[SYM]) throw new Error(`${SYM} is already in deployment.json`);

const chain = { ...base, rpcUrls: { default: { http: [RPC_URL] } } };
const transport = http(RPC_URL, { retryCount: 4, retryDelay: 1500 });
const pub = createPublicClient({ chain, transport });
// rehearsal: act as the owner on a forked chain (impersonated, no key); real run: the owner's key
const account = DRY_RUN ? D.owner : privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY.trim());
const owner = createWalletClient({ chain, transport, account });
const ownerAddr = DRY_RUN ? D.owner : account.address;
if (ownerAddr.toLowerCase() !== D.owner.toLowerCase()) throw new Error("DEPLOYER_PRIVATE_KEY is not the owner in deployment.json");
if (DRY_RUN) {
  await pub.request({ method: "hardhat_impersonateAccount", params: [D.owner] });
  await pub.request({ method: "hardhat_setBalance", params: [D.owner, "0x56BC75E2D63100000"] });
}

// the first Oracle price: the live fair value (the site must already serve SLV), else SLV's last close
async function startPrice() {
  const r = await fetch(process.env.ORACLE_URL || "https://nightshift.buzz/api/oracle", { signal: AbortSignal.timeout(20000) }).then((x) => x.json()).catch(() => null);
  const q = r?.quotes?.find((x) => x.token === SYM);
  if (q?.fairValue > 0) return { price: q.fairValue, confidence: q.confidence, from: "live Oracle" };
  throw new Error("The live Oracle doesn't serve SLV yet. Deploy the site with silver first (or set ORACLE_URL).");
}

let nonce = await pub.getTransactionCount({ address: ownerAddr, blockTag: "pending" });
const before = await pub.getBalance({ address: ownerAddr });
console.log(`owner ${ownerAddr}: ${formatEther(before)} ETH${DRY_RUN ? " (rehearsal)" : ""}`);
async function deploy(label, name, args) {
  const hash = await owner.deployContract({ abi: A[name].abi, bytecode: A[name].bytecode, args, nonce: nonce++ });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} failed: ${hash}`);
  console.log(`  ${label.padEnd(36)} ${r.contractAddress}`);
  return r.contractAddress;
}
async function send(label, address, name, fn, args) {
  const hash = await owner.writeContract({ address, abi: A[name].abi, functionName: fn, args, nonce: nonce++ });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} failed: ${hash}`);
  console.log(`  ${label}`);
}

const start = await startPrice();
console.log(`first price: ${start.price.toFixed(4)} (${start.from}, confidence ${start.confidence})`);
const startBlock = await pub.getBlockNumber();
console.log("Deploying:");
const token = await deploy("dSLV token", "TestToken", ["Nightshift Demo SLV (no value)", "dSLV", parseEther("100")]);
const adapter = await deploy("Morpho adapter dSLV", "MorphoOracleAdapter", [D.contracts.oracle, token, 86400n]);
const feed = await deploy("Chainlink-style feed dSLV", "NightshiftAggregatorV3", [D.contracts.oracle, token, "dSLV / USD (Nightshift fair value)"]);

console.log("Configuring:");
await send("faucet wallet may mint dSLV", token, "TestToken", "setMinter", [D.roles.faucet, true]);
await send(`Vault market dSLV: LLTV ${LLTV}`, D.contracts.vault, "NightshiftVault", "setMarket", [token, parseEther(LLTV), true]);
await send("first Oracle price (owner override)", D.contracts.oracle, "NightshiftOracle", "forceSetPrices", [[token], [parseEther(start.price.toFixed(6))], [start.confidence]]);

const price = await pub.readContract({ address: D.contracts.oracle, abi: A.NightshiftOracle.abi, functionName: "getPrice", args: [token] });
await new Promise((r) => setTimeout(r, 4000)); // public RPCs are load-balanced: give the new contracts a moment to be visible
const adapterPrice = await pub.readContract({ address: adapter, abi: A.MorphoOracleAdapter.abi, functionName: "price" });
console.log(`check: Oracle ${formatEther(price[0])}, adapter ${adapterPrice}, feed ok`);
const after = await pub.getBalance({ address: ownerAddr });
console.log(`owner spent ${formatEther(before - after)} ETH`);

if (DRY_RUN) console.log("rehearsal: deployment.json not changed");
else {
  const next = { ...D, tokens: { ...D.tokens, [SYM]: { address: token, lltv: Number(LLTV), adapter, feed } }, slvAddedAt: new Date().toISOString(), slvStartBlock: Number(startBlock) };
  fs.writeFileSync("lib/chain/deployment.json", JSON.stringify(next, null, 2) + "\n");
  console.log("wrote lib/chain/deployment.json");
}
