// Deploys the whole Nightshift EVM stack to Base Sepolia (testnet, chain 84532) and points the site at it.
// Base mainnet is retired (its record stays in lib/chain/deployment-base-mainnet.json); everything runs on a testnet:
//   tokens   tUSDG and tSPY, tQQQ, tGLD, tSLV, tIBIT (test tokens, hourly public faucet, the faucet wallet may mint)
//   core     NightshiftOracle, NightshiftVault (markets at the studied LLTVs), Groth16Verifier, CloakRegistry
//   feeds    per token: a Morpho-style adapter (refuses prices older than a day) and a Chainlink-style feed
//   stack    StackDemoPool (sells tGLD/tSLV at the Oracle price plus a spread) and StackPlan (recurring buys)
//   roles    the Oracle updater, the faucet minter; the deployer's ETH is shared out to the keeper, updater,
//            faucet and the three team demo wallets
// Then writes lib/chain/deployment.json.
//
//   DRY_RUN=1 RPC_URL=http://127.0.0.1:8547 node --env-file=.env.local scripts/deploy-testnet.mjs   (fork rehearsal)
//   node --env-file=.env.local scripts/deploy-testnet.mjs                                           (Base Sepolia)
import fs from "node:fs";
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
const DRY_RUN = process.env.DRY_RUN === "1";
const ORACLE_URL = process.env.ORACLE_URL || "https://nightshift.buzz/api/oracle";
const A = JSON.parse(fs.readFileSync("lib/chain/artifacts.json", "utf8"));
const ASSETS = [
  { token: "SPY", name: "Nightshift Test SPY", faucet: "10", lltv: "0.77", inventory: null },
  { token: "QQQ", name: "Nightshift Test QQQ", faucet: "10", lltv: "0.77", inventory: null },
  { token: "GLD", name: "Nightshift Test GLD", faucet: "20", lltv: "0.77", inventory: "2000", premiumCapBps: 50 },
  { token: "SLV", name: "Nightshift Test SLV", faucet: "100", lltv: "0.625", inventory: "20000", premiumCapBps: 75 },
  { token: "IBIT", name: "Nightshift Test IBIT", faucet: "200", lltv: "0.625", inventory: null },
];
const VAULT_LIQUIDITY = "50000000"; // tUSDG the Vault lends out

const chain = { ...baseSepolia, rpcUrls: { default: { http: [RPC_URL] } } };
const transport = http(RPC_URL, { retryCount: 4, retryDelay: 1500 });
const pub = createPublicClient({ chain, transport });
const key = (name) => {
  const k = process.env[name]?.trim();
  if (!k) throw new Error(`${name} is missing from .env.local`);
  return k;
};
const deployer = privateKeyToAccount(key("DEPLOYER_PRIVATE_KEY"));
const roleOf = (name) => privateKeyToAccount(key(name)).address;
const ROLES = { updater: roleOf("ORACLE_UPDATER_PRIVATE_KEY"), keeper: roleOf("KEEPER_PRIVATE_KEY"), faucet: roleOf("FAUCET_PRIVATE_KEY") };
const DEMO = ["DEMO_WALLET_1_PRIVATE_KEY", "DEMO_WALLET_2_PRIVATE_KEY", "DEMO_WALLET_3_PRIVATE_KEY"].filter((k) => process.env[k]).map(roleOf);
// rehearsal on a fork: act as the deployer without its key being needed by the fork
const wallet = createWalletClient({ chain, transport, account: DRY_RUN ? deployer.address : deployer });
if (DRY_RUN) {
  await pub.request({ method: "hardhat_impersonateAccount", params: [deployer.address] });
  await pub.request({ method: "hardhat_setBalance", params: [deployer.address, "0x16345785D8A0000"] }); // 0.1 ETH, about what a faucet gives
}

const chainId = await pub.getChainId();
if (chainId !== 84532) throw new Error(`expected Base Sepolia (84532), the RPC is chain ${chainId}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nonce = await pub.getTransactionCount({ address: deployer.address, blockTag: "pending" });
const before = await pub.getBalance({ address: deployer.address });
console.log(`deployer ${deployer.address}: ${formatEther(before)} ETH on Base Sepolia${DRY_RUN ? " (rehearsal)" : ""}`);
if (before < parseEther("0.003")) throw new Error("The deployer needs at least 0.003 Base Sepolia ETH. Fund it from a faucet first.");

const settle = () => sleep(DRY_RUN ? 0 : 2500); // public RPCs are load-balanced: let every node see the last transaction
async function deploy(label, name, args = []) {
  const hash = await wallet.deployContract({ abi: A[name].abi, bytecode: A[name].bytecode, args, nonce: nonce++ });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} failed: ${hash}`);
  console.log(`  ${label.padEnd(30)} ${r.contractAddress}`);
  await settle();
  return r.contractAddress;
}
async function send(label, address, name, fn, args) {
  const hash = await wallet.writeContract({ address, abi: A[name].abi, functionName: fn, args, nonce: nonce++ });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} failed: ${hash}`);
  console.log(`  ${label}`);
  await settle();
}

// starting prices: the live Oracle (it must serve every token, SLV included)
const snap = await fetch(ORACLE_URL, { signal: AbortSignal.timeout(20000) }).then((r) => r.json());
const quoteOf = Object.fromEntries((snap.quotes ?? []).map((q) => [q.token, q]));
for (const a of ASSETS) if (!(quoteOf[a.token]?.fairValue > 0)) throw new Error(`the live Oracle has no price for ${a.token}`);

const startBlock = await pub.getBlockNumber();
console.log("Deploying:");
const usdg = await deploy("tUSDG", "TestToken", ["Nightshift Test USDG", "tUSDG", parseEther("1000")]);
const tokens = {};
for (const a of ASSETS) tokens[a.token] = { address: await deploy(`t${a.token}`, "TestToken", [a.name, `t${a.token}`, parseEther(a.faucet)]), lltv: Number(a.lltv) };
const oracle = await deploy("NightshiftOracle", "NightshiftOracle");
const vault = await deploy("NightshiftVault", "NightshiftVault", [usdg, oracle]);
const verifier = await deploy("Groth16Verifier", "Groth16Verifier");
const cloakRegistry = await deploy("CloakRegistry", "CloakRegistry", [verifier, oracle, vault]);
for (const a of ASSETS) {
  const t = tokens[a.token].address;
  tokens[a.token].adapter = await deploy(`Morpho adapter t${a.token}`, "MorphoOracleAdapter", [oracle, t, 86400n]);
  tokens[a.token].feed = await deploy(`Chainlink-style feed t${a.token}`, "NightshiftAggregatorV3", [oracle, t, `t${a.token} / USD (Nightshift fair value)`]);
}
const pool = await deploy("StackDemoPool", "StackDemoPool", [usdg, oracle]);
const plan = await deploy("StackPlan", "StackPlan", [usdg, oracle, pool]);

console.log("Configuring:");
for (const a of ASSETS) await send(`Vault market t${a.token}: LLTV ${a.lltv}`, vault, "NightshiftVault", "setMarket", [tokens[a.token].address, parseEther(a.lltv), true]);
await send(`Vault liquidity: ${VAULT_LIQUIDITY} tUSDG`, usdg, "TestToken", "mint", [vault, parseEther(VAULT_LIQUIDITY)]);
await send(
  "starting Oracle prices",
  oracle,
  "NightshiftOracle",
  "setPrices",
  [ASSETS.map((a) => tokens[a.token].address), ASSETS.map((a) => parseEther(quoteOf[a.token].fairValue.toFixed(6))), ASSETS.map((a) => quoteOf[a.token].confidence)],
);
await send("Oracle updater role", oracle, "NightshiftOracle", "setUpdater", [ROLES.updater, true]);
for (const t of [usdg, ...ASSETS.map((a) => tokens[a.token].address)]) await send(`faucet may mint ${t.slice(0, 10)}…`, t, "TestToken", "setMinter", [ROLES.faucet, true]);
for (const a of ASSETS.filter((x) => x.inventory)) {
  await send(`Stack: allow t${a.token} (premium cap ${a.premiumCapBps / 100}%)`, plan, "StackPlan", "setAsset", [tokens[a.token].address, true, a.premiumCapBps]);
  await send(`Stack pool inventory: ${a.inventory} t${a.token}`, tokens[a.token].address, "TestToken", "mint", [pool, parseEther(a.inventory)]);
}

// share the deployer's remaining ETH: the updater pays for every price push; the keeper runs the Guardian and Stack;
// the faucet sends gas to visitors; each demo wallet gets a little for the activity loops
console.log("Funding role wallets:");
const left = await pub.getBalance({ address: deployer.address });
const keep = parseEther("0.0005"); // the deployer keeps a little for owner actions
const spendable = left > keep ? left - keep : 0n;
const shares = [
  ["updater", ROLES.updater, 30n],
  ["keeper", ROLES.keeper, 20n],
  ["faucet", ROLES.faucet, 35n],
  ...DEMO.map((d, i) => [`demo ${i + 1}`, d, 5n]),
];
for (const [label, to, pct] of shares) {
  // never send more than the balance minus this transfer's own fee (the shares add up to 100% of what was spendable)
  const fees = await pub.estimateFeesPerGas();
  const room = (await pub.getBalance({ address: deployer.address })) - keep - fees.maxFeePerGas * 21000n * 2n;
  const planned = (spendable * pct) / 100n;
  const value = planned < room ? planned : room > 0n ? room : 0n;
  if (value === 0n || to.toLowerCase() === deployer.address.toLowerCase()) continue;
  const hash = await wallet.sendTransaction({ to, value, gas: 21000n, nonce: nonce++ }); // a plain transfer: exactly 21,000 gas
  await pub.waitForTransactionReceipt({ hash });
  console.log(`  ${label.padEnd(8)} ${to}  ${formatEther(value)} ETH`);
  await settle();
}
console.log(`deployer spent ${formatEther(before - (await pub.getBalance({ address: deployer.address })))} ETH (gas and funding)`);

const deployment = {
  deployed: true,
  chainId: 84532,
  chainName: "Base Sepolia",
  rpcUrl: "https://sepolia.base.org",
  explorer: "https://sepolia.basescan.org",
  symbolPrefix: "t",
  deployedAt: new Date().toISOString(),
  startBlock: Number(startBlock),
  owner: deployer.address,
  keeper: ROLES.keeper,
  roles: ROLES,
  contracts: { usdg, oracle, vault, verifier, cloakRegistry },
  tokens,
  stack: { plan, pool, deployedAt: new Date().toISOString() },
};
if (DRY_RUN) console.log("rehearsal: deployment.json not changed");
else {
  fs.writeFileSync("lib/chain/deployment.json", JSON.stringify(deployment, null, 2) + "\n");
  console.log("wrote lib/chain/deployment.json (Base Sepolia)");
}
