import "server-only";
import { createPublicClient, createWalletClient, formatEther, parseEther, type Address, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getOracleSnapshot } from "@/lib/oracle";
import { ABI, DEPLOYMENT, chainOf, chainTransport, isDeployed } from "./index";

const WAD = 10n ** 18n;
const SLIPPAGE_WAD = 5n * 10n ** 15n; // 0.5%, as in NightshiftVault
const PUSH_DEVIATION = 0.001; // push when the price moved more than 0.1%…
const PUSH_MAX_AGE = 10 * 60; // …or the on-chain value is older than 10 minutes (health alarms at 15)
// Multicall3 lives at the same address on every major chain, Base Sepolia included.
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

/**
 * One wallet per job, so a drained faucet can never stop price updates or the Guardian:
 * - updater: pushes Oracle prices (authorised with NightshiftOracle.setUpdater)
 * - keeper:  calls protect() for the Guardian (anyone may; it only acts within each borrower's rule)
 * - faucet:  sends test ETH and mints test tokens (authorised with TestToken.setMinter)
 * The deployer/owner key is never needed on the server.
 */
export type Role = "updater" | "keeper" | "faucet";
const ROLE_ENV: Record<Role, string> = { updater: "ORACLE_UPDATER_PRIVATE_KEY", keeper: "KEEPER_PRIVATE_KEY", faucet: "FAUCET_PRIVATE_KEY" };

export function roleClients(role: Role) {
  const key = process.env[ROLE_ENV[role]]?.trim();
  if (!isDeployed || !key) return null;
  const chain = chainOf();
  const account = privateKeyToAccount(key as `0x${string}`);
  const transport = chainTransport();
  return { account, pub: createPublicClient({ chain, transport }) as PublicClient, wallet: createWalletClient({ chain, account, transport }) };
}

export function publicClient() {
  if (!isDeployed) return null;
  return createPublicClient({ chain: chainOf(), transport: chainTransport() }) as PublicClient;
}

/** Batched contract reads (one RPC round trip); falls back to sequential reads where Multicall3 isn't deployed. */
async function readMany(pub: PublicClient, calls: { address: Address; abi: unknown; functionName: string; args?: unknown[] }[]) {
  if (!calls.length) return [];
  try {
    const res = await pub.multicall({ contracts: calls as never, multicallAddress: MULTICALL3, allowFailure: false });
    return res as unknown[];
  } catch {
    const out: unknown[] = [];
    for (const c of calls) out.push(await pub.readContract(c as never));
    return out;
  }
}

/** Pushes Oracle fair values on-chain when they moved or went stale. Never pushes simulated prices. */
export async function pushPrices() {
  const c = roleClients("updater");
  if (!c) return { skipped: "oracle updater not configured" };
  const snap = await getOracleSnapshot();
  const now = Math.floor(Date.now() / 1000);
  const quotes = snap.quotes.filter((q) => DEPLOYMENT.tokens[q.token]);
  const live = quotes.filter((q) => q.source === "live");
  const skippedSimulated = quotes.filter((q) => q.source !== "live").map((q) => q.token);
  const onchain = (await readMany(
    c.pub,
    live.map((q) => ({ address: DEPLOYMENT.contracts.oracle, abi: ABI.oracle, functionName: "getPrice", args: [DEPLOYMENT.tokens[q.token].address] })),
  )) as [bigint, number, bigint][];
  const tokens: Address[] = [];
  const prices: bigint[] = [];
  const confs: number[] = [];
  live.forEach((q, i) => {
    const [price, , updatedAt] = onchain[i];
    const current = Number(formatEther(price));
    const moved = current === 0 || Math.abs(q.fairValue / current - 1) > PUSH_DEVIATION;
    if (moved || now - Number(updatedAt) > PUSH_MAX_AGE) {
      tokens.push(DEPLOYMENT.tokens[q.token].address);
      prices.push(parseEther(q.fairValue.toFixed(6)));
      confs.push(q.confidence);
    }
  });
  if (!tokens.length) return { pushed: 0, skippedSimulated };
  const hash = await c.wallet.writeContract({ address: DEPLOYMENT.contracts.oracle, abi: ABI.oracle, functionName: "setPrices", args: [tokens, prices, confs] });
  await c.pub.waitForTransactionReceipt({ hash });
  return { pushed: tokens.length, tx: hash, skippedSimulated };
}

/** On-chain Guardian: protects every opted-in position whose health factor is under its trigger. */
export async function runGuardian() {
  const c = roleClients("keeper");
  if (!c) return { skipped: "guardian keeper not configured" };
  const vault = DEPLOYMENT.contracts.vault;
  const count = Number(await c.pub.readContract({ address: vault, abi: ABI.vault, functionName: "positionCount" }));
  const actions: { user: string; collateral: string; tx: string }[] = [];
  const alerts: { user: string; collateral: string; reason: string }[] = [];
  for (let off = 0; off < count; off += 100) {
    const [users, cols, colls, debts] = (await c.pub.readContract({ address: vault, abi: ABI.vault, functionName: "getPositions", args: [BigInt(off), 100n] })) as [Address[], Address[], bigint[], bigint[]];
    const open = users.map((u, i) => i).filter((i) => debts[i] > 0n);
    // one batched read for every open position's rule and health factor, plus each collateral's price
    const rules = (await readMany(c.pub, open.map((i) => ({ address: vault, abi: ABI.vault, functionName: "rules", args: [users[i], cols[i]] })))) as [number, bigint, bigint][];
    const watched = open.filter((_, j) => rules[j][0] === 2);
    const watchedRules = open.map((i, j) => [i, rules[j]] as const).filter(([, r]) => r[0] === 2);
    const hfs = (await readMany(c.pub, watched.map((i) => ({ address: vault, abi: ABI.vault, functionName: "healthFactor", args: [users[i], cols[i]] })))) as bigint[];
    const uniqueCols = [...new Set(watched.map((i) => cols[i]))];
    const priceRows = (await readMany(c.pub, uniqueCols.map((col) => ({ address: DEPLOYMENT.contracts.oracle, abi: ABI.oracle, functionName: "getPrice", args: [col] })))) as [bigint, number, bigint][];
    const priceOf = new Map(uniqueCols.map((col, k) => [col, priceRows[k][0]]));
    for (let j = 0; j < watched.length; j++) {
      const i = watched[j];
      const trigger = watchedRules[j][1][1];
      const hf = hfs[j];
      if (hf >= trigger || hf < WAD) continue;
      // G4 (formal/Nightshift/Guardian.lean): if the collateral at the slippage price can't cover the debt,
      // selling only lowers health, so alert instead of calling protect (the contract enforces the same rule).
      const sellPrice = ((priceOf.get(cols[i]) ?? 0n) * (WAD - SLIPPAGE_WAD)) / WAD;
      if ((colls[i] * sellPrice) / WAD <= debts[i]) {
        alerts.push({ user: users[i], collateral: cols[i], reason: "selling can't restore health; alert only" });
        continue;
      }
      const hash = await c.wallet.writeContract({ address: vault, abi: ABI.vault, functionName: "protect", args: [users[i], cols[i]] });
      await c.pub.waitForTransactionReceipt({ hash });
      actions.push({ user: users[i], collateral: cols[i], tx: hash });
    }
  }
  return { checked: count, protected: actions, alerts };
}
