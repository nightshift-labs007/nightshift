import "server-only";
import { formatEther, parseEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ABI, DEPLOYMENT, isDeployed } from "@/lib/chain";
import { publicClient } from "@/lib/chain/keeper";
import { configProblems, configStatus, env } from "./env";

const STALE_SEC = 15 * 60;
const LOW: Record<string, bigint> = { updater: parseEther("0.0005"), keeper: parseEther("0.0005"), faucet: parseEther("0.001") };
const addrOf = (k: string): Address | null => (/^0x[0-9a-fA-F]{64}$/.test(k) ? privateKeyToAccount(k as `0x${string}`).address : null);

/** Operational health: role-wallet balances, on-chain price freshness, last Guardian action, configuration. */
export async function getHealth() {
  const config = configStatus();
  const problems = configProblems();
  const issues: string[] = [...problems];
  const out: Record<string, unknown> = { at: new Date().toISOString(), deployed: isDeployed, config, problems };
  if (!isDeployed) {
    out.ok = problems.length === 0;
    out.issues = issues;
    out.note = "Contracts not deployed yet: on-chain checks are skipped.";
    return out;
  }
  const pub = publicClient()!;
  const wallets: Record<string, { address: Address; eth: number; low: boolean } | null> = {};
  for (const [role, key] of [["updater", env.updaterKey], ["keeper", env.keeperKey], ["faucet", env.faucetKey]] as const) {
    const a = addrOf(key);
    if (!a) {
      wallets[role] = null;
      issues.push(`${role} wallet not configured`);
      continue;
    }
    const bal = await pub.getBalance({ address: a });
    wallets[role] = { address: a, eth: Number(formatEther(bal)), low: bal < LOW[role] };
    if (bal < LOW[role]) issues.push(`${role} wallet low on gas (${Number(formatEther(bal)).toFixed(5)} ETH)`);
  }
  out.wallets = wallets;

  const now = Math.floor(Date.now() / 1000);
  const prices: Record<string, { price: number; confidence: number; ageSec: number; stale: boolean }> = {};
  for (const [sym, t] of Object.entries(DEPLOYMENT.tokens)) {
    const [p, c, updatedAt] = (await pub.readContract({ address: DEPLOYMENT.contracts.oracle, abi: ABI.oracle as never, functionName: "getPrice" as never, args: [t.address] as never })) as [bigint, number, bigint];
    const age = now - Number(updatedAt);
    prices[sym] = { price: Number(formatEther(p)), confidence: Number(c), ageSec: age, stale: age > STALE_SEC };
    if (age > STALE_SEC) issues.push(`${sym} on-chain price is ${Math.round(age / 60)} min old`);
  }
  out.prices = prices;

  try {
    const latest = await pub.getBlockNumber();
    const from = latest > 40_000n ? latest - 40_000n : 0n;
    const logs = await pub.getContractEvents({ address: DEPLOYMENT.contracts.vault, abi: ABI.vault as never, eventName: "Protected" as never, fromBlock: from });
    const last = (logs as { transactionHash: string; blockNumber: bigint }[])[logs.length - 1];
    out.lastGuardianAction = last ? { tx: last.transactionHash, block: Number(last.blockNumber) } : null;
  } catch {
    out.lastGuardianAction = "unavailable";
  }
  out.ok = issues.length === 0;
  out.issues = issues;
  return out;
}
