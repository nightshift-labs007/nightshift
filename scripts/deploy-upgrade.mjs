// Security-review upgrade: deploys a new NightshiftVault (reentrancy guard, effects before transfers, on-chain
// confidence decay, 2-day max price age), Morpho adapters that refuse stale prices, Chainlink-style feeds, and the
// CloakRegistry. Reuses the existing Oracle, tokens and Groth16 verifier from lib/chain/deployment.json and writes the
// new addresses back (the old Vault and adapters are kept under "previous").
//
//   node --env-file=.env.local scripts/deploy-upgrade.mjs                  (Base mainnet, writes deployment.json)
//   RPC_URL=http://127.0.0.1:8546 DRY_RUN=1 node --env-file=.env.local scripts/deploy-upgrade.mjs   (fork rehearsal)
//
// Gas: the deployer (owner) deploys and sets markets; the faucet wallet (USDG minter) funds the new Vault.
import fs from "node:fs";
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const DRY_RUN = process.env.DRY_RUN === "1";
const D = JSON.parse(fs.readFileSync("lib/chain/deployment.json", "utf8"));
const A = JSON.parse(fs.readFileSync("lib/chain/artifacts.json", "utf8"));
if (D.chainId !== 8453) throw new Error("deployment.json is not the Base mainnet deployment");

const chain = { ...base, rpcUrls: { default: { http: [RPC_URL] } } };
const transport = http(RPC_URL, { retryCount: 4, retryDelay: 1500 });
const pub = createPublicClient({ chain, transport });
const deployer = createWalletClient({ chain, transport, account: privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY.trim()) });
const minter = createWalletClient({ chain, transport, account: privateKeyToAccount(process.env.FAUCET_PRIVATE_KEY.trim()) });
if (deployer.account.address.toLowerCase() !== D.owner.toLowerCase()) throw new Error("DEPLOYER_PRIVATE_KEY is not the owner in deployment.json");

// explicit nonces: public RPCs are load-balanced and may not have seen our previous transaction yet
const nonces = new Map();
const nextNonce = async (w) => {
  const a = w.account.address;
  if (!nonces.has(a)) nonces.set(a, await pub.getTransactionCount({ address: a, blockTag: "pending" }));
  const n = nonces.get(a);
  nonces.set(a, n + 1);
  return n;
};
let gasUsed = 0n, spent = 0n;
const track = (r) => { gasUsed += r.gasUsed; spent += r.gasUsed * r.effectiveGasPrice + (r.l1Fee ?? 0n); return r; };
async function deploy(label, name, args) {
  const hash = await deployer.deployContract({ abi: A[name].abi, bytecode: A[name].bytecode, args, nonce: await nextNonce(deployer) });
  const r = track(await pub.waitForTransactionReceipt({ hash }));
  if (r.status !== "success") throw new Error(`${label} failed: ${hash}`);
  console.log(`  ${label.padEnd(28)} ${r.contractAddress}`);
  return r.contractAddress;
}
async function send(w, label, address, name, fn, args) {
  const hash = await w.writeContract({ address, abi: A[name].abi, functionName: fn, args, nonce: await nextNonce(w) });
  const r = track(await pub.waitForTransactionReceipt({ hash }));
  if (r.status !== "success") throw new Error(`${label} failed: ${hash}`);
  console.log(`  ${label}`);
}

const before = await pub.getBalance({ address: deployer.account.address });
console.log(`deployer ${deployer.account.address}: ${formatEther(before)} ETH${DRY_RUN ? " (rehearsal)" : ""}`);
const startBlock = await pub.getBlockNumber();
const { oracle, usdg, verifier } = D.contracts;

console.log("Deploying:");
const vault = await deploy("NightshiftVault", "NightshiftVault", [usdg, oracle]);
const tokens = {};
for (const [sym, t] of Object.entries(D.tokens)) {
  const adapter = await deploy(`Morpho adapter d${sym}`, "MorphoOracleAdapter", [oracle, t.address, 86400n]);
  const feed = await deploy(`Chainlink-style feed d${sym}`, "NightshiftAggregatorV3", [oracle, t.address, `d${sym} / USD (Nightshift fair value)`]);
  tokens[sym] = { ...t, adapter, feed };
}
const cloakRegistry = await deploy("CloakRegistry", "CloakRegistry", [verifier, oracle, vault]);

console.log("Configuring:");
for (const [sym, t] of Object.entries(tokens)) await send(deployer, `market d${sym}: LLTV ${t.lltv}`, vault, "NightshiftVault", "setMarket", [t.address, parseEther(String(t.lltv)), true]);
await send(minter, "fund the Vault with 10,000,000 dUSDG (demo)", usdg, "TestToken", "mint", [vault, parseEther("10000000")]);

const after = await pub.getBalance({ address: deployer.account.address });
console.log(`\ngas used ${gasUsed}; deployer spent ${formatEther(before - after)} ETH; all wallets ${formatEther(spent)} ETH (incl. L1 data fee)`);

if (DRY_RUN) {
  console.log("rehearsal: deployment.json not changed");
} else {
  const next = {
    ...D,
    upgradedAt: new Date().toISOString(),
    upgradeStartBlock: Number(startBlock),
    contracts: { ...D.contracts, vault, cloakRegistry },
    tokens,
    previous: { vault: D.contracts.vault, adapters: Object.fromEntries(Object.entries(D.tokens).map(([s, t]) => [s, t.adapter])), startBlock: D.startBlock },
    startBlock: Number(startBlock),
  };
  fs.writeFileSync("lib/chain/deployment.json", JSON.stringify(next, null, 2) + "\n");
  console.log("wrote lib/chain/deployment.json");
}
