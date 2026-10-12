// Moves the deployer's test ETH from Ethereum Sepolia to Base Sepolia through Base's official L1StandardBridge
// (address from docs.base.org/chain/base-contracts). Keeps a little on Sepolia for this transaction's gas.
// Usage: node --env-file=.env.local scripts/bridge-to-base-sepolia.mjs
import { createPublicClient, createWalletClient, formatEther, http, parseAbi, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, sepolia } from "viem/chains";

const L1_STANDARD_BRIDGE = "0xfd0Bf71F60660E2f608ed56e1659C450eB113120";
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY.trim());
const l1 = createPublicClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com") });
const l2 = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });
const wallet = createWalletClient({ chain: sepolia, account, transport: http("https://ethereum-sepolia-rpc.publicnode.com") });

const bal = await l1.getBalance({ address: account.address });
const keep = parseEther("0.004"); // gas for the deposit itself (Sepolia gas can spike)
if (bal <= keep) throw new Error(`Only ${formatEther(bal)} ETH on Ethereum Sepolia; need more than ${formatEther(keep)}`);
const value = bal - keep;
const before = await l2.getBalance({ address: account.address });
console.log(`Bridging ${formatEther(value)} ETH from Ethereum Sepolia to Base Sepolia for ${account.address}…`);
const hash = await wallet.writeContract({
  address: L1_STANDARD_BRIDGE,
  abi: parseAbi(["function depositETH(uint32 _minGasLimit, bytes _extraData) payable"]),
  functionName: "depositETH",
  args: [200_000, "0x"],
  value,
});
const r = await l1.waitForTransactionReceipt({ hash });
console.log(`L1 deposit ${r.status}: https://sepolia.etherscan.io/tx/${hash}`);
for (let i = 0; i < 60; i++) {
  await new Promise((res) => setTimeout(res, 15000));
  const now = await l2.getBalance({ address: account.address });
  if (now > before) {
    console.log(`Arrived on Base Sepolia: ${formatEther(now)} ETH`);
    process.exit(0);
  }
}
console.log("Deposit sent; Base Sepolia usually credits it within a few minutes.");
