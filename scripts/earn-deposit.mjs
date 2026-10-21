// Deposits PYUSD from the team Earn wallet into the Sentora Protected RWA vault on Ethereum mainnet. Real money.
// Usage: node --env-file=.env.local scripts/earn-deposit.mjs <amount in PYUSD, e.g. 9>
import { createPublicClient, createWalletClient, fallback, http, parseAbi, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

const VAULT = "0xd000E6BcAd5457E8F4de67eDdeFe50BCC4B3d743";
const PYUSD = "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8";
const amount = parseUnits(process.argv[2] ?? "", 6);
const key = process.env.EARN_WALLET_PRIVATE_KEY;
if (!key || amount <= 0n) throw new Error("usage: earn-deposit.mjs <amount>");

const transport = fallback(["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"].map((u) => http(u, { retryCount: 3, retryDelay: 800 })));
const pub = createPublicClient({ chain: mainnet, transport });
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ chain: mainnet, account, transport });
const abi = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function deposit(address,uint256,address) returns (uint256)",
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bal = await pub.readContract({ address: PYUSD, abi, functionName: "balanceOf", args: [account.address] });
if (bal < amount) throw new Error(`only ${formatUnits(bal, 6)} PYUSD in the wallet`);
let nonce = await pub.getTransactionCount({ address: account.address, blockTag: "pending" });
const send = async (label, address, functionName, args) => {
  const hash = await wallet.writeContract({ address, abi, functionName, args, nonce: nonce++ });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`${label.padEnd(22)} https://etherscan.io/tx/${hash}`);
  await sleep(3000);
};
// approve exactly the amount being deposited, no more
await send("approve PYUSD", PYUSD, "approve", [VAULT, amount]);
await pub.simulateContract({ address: VAULT, abi, functionName: "deposit", args: [PYUSD, amount, account.address], account });
await send(`deposit ${formatUnits(amount, 6)} PYUSD`, VAULT, "deposit", [PYUSD, amount, account.address]);
console.log("done · PYUSD left", formatUnits(await pub.readContract({ address: PYUSD, abi, functionName: "balanceOf", args: [account.address] }), 6));
