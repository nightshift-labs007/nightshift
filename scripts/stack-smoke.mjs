// On-chain smoke test of Stack on Base mainnet (demo tokens): a team wallet creates a plan, another wallet executes it.
//   node --env-file=.env.local scripts/stack-smoke.mjs [GLD|SLV] [amount in dUSDG]
import fs from "node:fs";
import { createPublicClient, createWalletClient, fallback, http, formatEther, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const D = JSON.parse(fs.readFileSync("lib/chain/deployment.json", "utf8"));
const A = JSON.parse(fs.readFileSync("lib/chain/artifacts.json", "utf8"));
const sym = process.argv[2] ?? "GLD";
const amount = parseEther(process.argv[3] ?? "20");
const token = D.tokens[sym].address;
const { plan, pool } = D.stack;
const transport = fallback(["https://base-rpc.publicnode.com", "https://mainnet.base.org"].map((u) => http(u, { retryCount: 3, retryDelay: 800 })));
const pub = createPublicClient({ chain: base, transport });
const user = createWalletClient({ chain: base, transport, account: privateKeyToAccount(process.env.DEMO_WALLET_1_PRIVATE_KEY.trim()) });
const keeper = createWalletClient({ chain: base, transport, account: privateKeyToAccount(process.env.DEMO_WALLET_2_PRIVATE_KEY.trim()) }); // anyone may execute
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nonces = {};
const send = async (w, label, address, name, fn, args) => {
  const a = w.account.address;
  nonces[a] ??= await pub.getTransactionCount({ address: a, blockTag: "pending" });
  const hash = await w.writeContract({ address, abi: A[name].abi, functionName: fn, args, nonce: nonces[a]++ });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`${label.padEnd(34)} https://basescan.org/tx/${hash}`);
  await sleep(3500);
  return r;
};
const read = (address, name, fn, args = []) => pub.readContract({ address, abi: A[name].abi, functionName: fn, args });

const me = user.account.address;
const [price, conf, at] = await read(D.contracts.oracle, "NightshiftOracle", "getPrice", [token]);
console.log(`${sym} Oracle price ${formatEther(price)}, confidence ${conf}, ${Math.round(Date.now() / 1000 - Number(at))}s old`);
const usdgBefore = await read(D.contracts.usdg, "TestToken", "balanceOf", [me]);
const assetBefore = await read(token, "TestToken", "balanceOf", [me]);
const now = Math.floor(Date.now() / 1000);

await send(user, `approve ${formatEther(amount * 5n)} dUSDG for Stack`, D.contracts.usdg, "TestToken", "approve", [plan, amount * 5n]);
await send(user, `create plan: ${formatEther(amount)} dUSDG of d${sym} hourly`, plan, "StackPlan", "createPlan", [token, amount, 3600, now + 120, 3600, sym === "SLV" ? 75 : 50, 75, amount * 5n, now + 30 * 86400]);
const id = (await read(plan, "StackPlan", "planCount")) - 1n;
console.log(`plan #${id}; waiting for its window to open…`);
await sleep(125_000);
const p = await read(plan, "StackPlan", "getPlan", [id]);
console.log(`due: ${await read(plan, "StackPlan", "isDue", [id])}`);
await send(keeper, `execute plan #${id} (called by another wallet)`, plan, "StackPlan", "execute", [id]);
await sleep(4000);
const got = (await read(token, "TestToken", "balanceOf", [me])) - assetBefore;
const spent = usdgBefore - (await read(D.contracts.usdg, "TestToken", "balanceOf", [me]));
console.log(`spent ${formatEther(spent)} dUSDG, received ${formatEther(got)} d${sym} (paid ${(Number(formatEther(spent)) / Number(formatEther(got))).toFixed(4)} each vs fair ${Number(formatEther(price)).toFixed(4)})`);
console.log("plan:", JSON.stringify(await read(plan, "StackPlan", "getPlan", [id]), (k, v) => (typeof v === "bigint" ? v.toString() : v)));
