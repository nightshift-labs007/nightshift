// Runs one full Vault loop from a team demo wallet on Base: faucet, deposit, borrow, Guardian rule, repay, withdraw.
// Every step is a real transaction on the public contracts, so it shows up on /transactions. Demo assets only.
// Usage: node --env-file=.env.local scripts/demo-activity.mjs <1|2|3> [SPY|QQQ|GLD|IBIT] [resume-from-step 0-7]
import { createPublicClient, createWalletClient, fallback, http, formatEther, maxUint256, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import fs from "node:fs";

const dep = JSON.parse(fs.readFileSync(new URL("../lib/chain/deployment.json", import.meta.url), "utf8"));
const abis = JSON.parse(fs.readFileSync(new URL("../lib/chain/abis.json", import.meta.url), "utf8"));
const n = process.argv[2];
const sym = process.argv[3] ?? ["SPY", "QQQ", "GLD"][Number(n) - 1];
const key = process.env[`DEMO_WALLET_${n}_PRIVATE_KEY`];
if (!key || !dep.tokens[sym]) throw new Error("usage: demo-activity.mjs <1|2|3> [SPY|QQQ|GLD|IBIT]");

const transport = fallback(["https://base-rpc.publicnode.com", "https://base.drpc.org", "https://mainnet.base.org"].map((u) => http(u, { retryCount: 3, retryDelay: 800 })));
const pub = createPublicClient({ chain: base, transport });
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ chain: base, account, transport });
const { vault, usdg } = dep.contracts;
const token = dep.tokens[sym].address;
const V = { address: vault, abi: abis.NightshiftVault };
const T = { address: token, abi: abis.TestToken };
const U = { address: usdg, abi: abis.TestToken };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nonce = await pub.getTransactionCount({ address: account.address, blockTag: "pending" });
async function send(label, c, functionName, args) {
  const hash = await wallet.writeContract({ ...c, functionName, args, nonce: nonce++ });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`${label.padEnd(28)} https://basescan.org/tx/${hash}`);
  await sleep(2500); // let the load-balanced RPC nodes catch up before the next read
}
// public RPCs are load-balanced: read until the value is non-zero (a fresh transaction may not be visible yet)
async function readNonZero(c, functionName, args) {
  for (let i = 0; i < 20; i++) {
    const v = await pub.readContract({ ...c, functionName, args });
    if (v > 0n) return v;
    await sleep(2000);
  }
  throw new Error(`${functionName} stayed zero`);
}

const from = Number(process.argv[4] ?? 0);
console.log(`wallet ${n} ${account.address} · ${sym} · ${formatEther(await pub.getBalance({ address: account.address }))} ETH`);
const steps = [
  async () => { if ((await pub.readContract({ ...T, functionName: "balanceOf", args: [account.address] })) === 0n) await send(`faucet ${sym}`, T, "faucet", []); },
  async () => send(`approve ${sym}`, T, "approve", [vault, maxUint256]),
  async () => { const col = await readNonZero(T, "balanceOf", [account.address]); await send(`deposit ${formatEther(col)} ${sym}`, V, "deposit", [token, col]); },
  async () => { const limit = await readNonZero(V, "borrowLimit", [account.address, token]); const loan = limit / 4n; await send(`borrow ${Number(formatEther(loan)).toFixed(2)} USDG`, V, "borrow", [token, loan]); },
  async () => send("Guardian rule on", V, "setRule", [token, 2, parseEther("1.3"), parseEther("1.5")]),
  async () => send("approve USDG", U, "approve", [vault, maxUint256]),
  async () => { const usd = await readNonZero(U, "balanceOf", [account.address]); await send(`repay ${Number(formatEther(usd / 2n)).toFixed(2)} USDG`, V, "repay", [token, usd / 2n]); },
  async () => { const col = await readNonZero(V, "collateralValue", [account.address, token]); const amt = parseEther("1"); await send(`withdraw 1 ${sym}`, V, "withdraw", [token, amt]); void col; },
];
for (let i = from; i < steps.length; i++) await steps[i]();
const hf = await pub.readContract({ ...V, functionName: "healthFactor", args: [account.address, token] });
console.log(`done · health factor ${Number(formatEther(hf)).toFixed(2)} · ${formatEther(await pub.getBalance({ address: account.address }))} ETH left`);
