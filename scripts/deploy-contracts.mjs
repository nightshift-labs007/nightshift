// Deploys the Nightshift testnet stack and writes lib/chain/deployment.json.
// Usage: DEPLOYER_PRIVATE_KEY=0x... npm run contracts:deploy
// Optional: RPC_URL (default Base Sepolia), CHAIN_ID, ORACLE_URL (where to read starting prices),
// NEW_OWNER (hand every contract to this address at the end, e.g. the team's own wallet).
// On Base mainnet (CHAIN_ID=8453) every asset is a clearly labelled demo token with no value ("dSPY", "dUSDG").
// Role wallets (recommended): ORACLE_UPDATER_PRIVATE_KEY, KEEPER_PRIVATE_KEY, FAUCET_PRIVATE_KEY. The deployer stays the
// owner and is never needed on the server: the updater pushes prices, the keeper runs the Guardian, the faucet mints.
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
const CHAIN_ID = Number(process.env.CHAIN_ID || 84532);
const ORACLE_URL = process.env.ORACLE_URL || "https://nightshift.buzz/api/oracle";
const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!key) throw new Error("Set DEPLOYER_PRIVATE_KEY");

const chain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 84532 ? "Base Sepolia" : CHAIN_ID === 8453 ? "Base" : `chain ${CHAIN_ID}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
const account = privateKeyToAccount(key);
const roleAddr = (k) => (process.env[k] ? privateKeyToAccount(process.env[k].trim()).address : null);
const ROLES = { updater: roleAddr("ORACLE_UPDATER_PRIVATE_KEY"), keeper: roleAddr("KEEPER_PRIVATE_KEY"), faucet: roleAddr("FAUCET_PRIVATE_KEY") };
const pub = createPublicClient({ chain, transport: http(RPC_URL) });
const wallet = createWalletClient({ chain, account, transport: http(RPC_URL) });
const A = JSON.parse(fs.readFileSync("lib/chain/artifacts.json", "utf8"));

async function deploy(name, args = []) {
  const hash = await wallet.deployContract({ abi: A[name].abi, bytecode: A[name].bytecode, args });
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`  ${name.padEnd(20)} ${r.contractAddress}`);
  return r.contractAddress;
}
async function send(address, name, fn, args) {
  const hash = await wallet.writeContract({ address, abi: A[name].abi, functionName: fn, args });
  await pub.waitForTransactionReceipt({ hash });
}

const MAINNET = CHAIN_ID === 8453;
const PREFIX = MAINNET ? "d" : "t";
const label = (name) => (MAINNET ? name.replace("Nightshift Test", "Nightshift Demo") + " (no value)" : name);
const ASSETS = [
  { token: "SPY", name: "Nightshift Test SPY", faucet: "10", lltv: "0.77" },
  { token: "QQQ", name: "Nightshift Test QQQ", faucet: "10", lltv: "0.77" },
  { token: "GLD", name: "Nightshift Test GLD", faucet: "20", lltv: "0.77" },
  { token: "IBIT", name: "Nightshift Test IBIT", faucet: "200", lltv: "0.625" },
];

const balance = await pub.getBalance({ address: account.address });
console.log(`Deployer ${account.address} on ${chain.name} (${chain.id}), balance ${Number(balance) / 1e18} ETH`);
if (balance === 0n) throw new Error("Deployer has no gas. Fund it from a faucet first.");
const startBlock = await pub.getBlockNumber();

console.log("Deploying:");
const usdg = await deploy("TestToken", [label("Nightshift Test USDG"), `${PREFIX}USDG`, parseEther("1000")]);
const tokens = {};
for (const a of ASSETS) tokens[a.token] = await deploy("TestToken", [label(a.name), `${PREFIX}${a.token}`, parseEther(a.faucet)]);
const oracle = await deploy("NightshiftOracle");
const vault = await deploy("NightshiftVault", [usdg, oracle]);
const verifier = await deploy("Groth16Verifier");
const adapters = {};
for (const a of ASSETS) adapters[a.token] = await deploy("MorphoOracleAdapter", [oracle, tokens[a.token]]);

console.log("Configuring markets, liquidity and starting prices…");
for (const a of ASSETS) await send(vault, "NightshiftVault", "setMarket", [tokens[a.token], parseEther(a.lltv), true]);
await send(usdg, "TestToken", "mint", [vault, parseEther("50000000")]);

const snap = await (await fetch(ORACLE_URL)).json();
const toks = [];
const prices = [];
const confs = [];
for (const q of snap.quotes) {
  if (!tokens[q.token]) continue;
  toks.push(tokens[q.token]);
  prices.push(parseEther(q.fairValue.toFixed(6)));
  confs.push(q.confidence);
}
await send(oracle, "NightshiftOracle", "setPrices", [toks, prices, confs]);

console.log("Authorising role wallets…");
if (ROLES.updater) await send(oracle, "NightshiftOracle", "setUpdater", [ROLES.updater, true]);
if (ROLES.faucet) for (const t of [usdg, ...Object.values(tokens)]) await send(t, "TestToken", "setMinter", [ROLES.faucet, true]);

// hand ownership to the team's wallet (owner powers: price override, markets, roles), then split the ETH
const NEW_OWNER = process.env.NEW_OWNER?.trim();
if (NEW_OWNER) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(NEW_OWNER)) throw new Error("NEW_OWNER is not an address");
  console.log(`Transferring ownership to ${NEW_OWNER}…`);
  for (const t of [usdg, ...Object.values(tokens)]) await send(t, "TestToken", "transferOwnership", [NEW_OWNER]);
  await send(oracle, "NightshiftOracle", "transferOwnership", [NEW_OWNER]);
  await send(vault, "NightshiftVault", "transferOwnership", [NEW_OWNER]);
}

// split the deployer's remaining ETH between the job wallets (the updater pays for every price push)
const left = await pub.getBalance({ address: account.address });
const share = MAINNET ? { updater: 55n, keeper: 20n, faucet: 20n } : { updater: 35n, keeper: 25n, faucet: 30n };
for (const [role, pct] of Object.entries(share)) {
  const to = ROLES[role];
  if (!to || to === account.address) continue;
  const value = (left * pct) / 100n;
  const hash = await wallet.sendTransaction({ to, value });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`  funded ${role.padEnd(8)} ${to}  ${Number(value) / 1e18} ETH`);
}

const deployment = {
  deployed: true,
  chainId: chain.id,
  chainName: chain.name,
  rpcUrl: RPC_URL,
  explorer: chain.id === 84532 ? "https://sepolia.basescan.org" : chain.id === 8453 ? "https://basescan.org" : "",
  symbolPrefix: PREFIX,
  deployedAt: new Date().toISOString(),
  startBlock: Number(startBlock),
  owner: NEW_OWNER || account.address,
  keeper: ROLES.keeper ?? account.address,
  roles: { updater: ROLES.updater ?? account.address, keeper: ROLES.keeper ?? account.address, faucet: ROLES.faucet ?? account.address },
  contracts: { usdg, oracle, vault, verifier },
  tokens: Object.fromEntries(ASSETS.map((a) => [a.token, { address: tokens[a.token], lltv: Number(a.lltv), adapter: adapters[a.token] }])),
};
fs.writeFileSync("lib/chain/deployment.json", JSON.stringify(deployment, null, 2));
console.log("Wrote lib/chain/deployment.json");
