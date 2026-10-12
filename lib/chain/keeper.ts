import "server-only";
import { createPublicClient, createWalletClient, formatEther, http, parseEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getOracleSnapshot } from "@/lib/oracle";
import { ABI, DEPLOYMENT, chainOf, isDeployed } from "./index";

const WAD = 10n ** 18n;
const PUSH_DEVIATION = 0.001; // push when the price moved more than 0.1%…
const PUSH_MAX_AGE = 30 * 60; // …or the on-chain value is older than 30 minutes

export function keeperClients() {
  const key = process.env.KEEPER_PRIVATE_KEY?.trim();
  if (!isDeployed || !key) return null;
  const chain = chainOf();
  const account = privateKeyToAccount(key as `0x${string}`);
  const transport = http(DEPLOYMENT.rpcUrl);
  return { account, pub: createPublicClient({ chain, transport }), wallet: createWalletClient({ chain, account, transport }) };
}

/** Pushes Oracle fair values on-chain when they moved or went stale. */
export async function pushPrices() {
  const c = keeperClients();
  if (!c) return { skipped: "keeper not configured" };
  const snap = await getOracleSnapshot();
  const now = Math.floor(Date.now() / 1000);
  const tokens: Address[] = [];
  const prices: bigint[] = [];
  const confs: number[] = [];
  for (const q of snap.quotes) {
    const t = DEPLOYMENT.tokens[q.token];
    if (!t) continue;
    const [onchain, , updatedAt] = (await c.pub.readContract({ address: DEPLOYMENT.contracts.oracle, abi: ABI.oracle, functionName: "getPrice", args: [t.address] })) as [bigint, number, bigint];
    const current = Number(formatEther(onchain));
    const moved = current === 0 || Math.abs(q.fairValue / current - 1) > PUSH_DEVIATION;
    if (moved || now - Number(updatedAt) > PUSH_MAX_AGE) {
      tokens.push(t.address);
      prices.push(parseEther(q.fairValue.toFixed(6)));
      confs.push(q.confidence);
    }
  }
  if (!tokens.length) return { pushed: 0 };
  const hash = await c.wallet.writeContract({ address: DEPLOYMENT.contracts.oracle, abi: ABI.oracle, functionName: "setPrices", args: [tokens, prices, confs] });
  await c.pub.waitForTransactionReceipt({ hash });
  return { pushed: tokens.length, tx: hash };
}

/** On-chain Guardian: protects every opted-in position whose health factor is under its trigger. */
export async function runGuardian() {
  const c = keeperClients();
  if (!c) return { skipped: "keeper not configured" };
  const vault = DEPLOYMENT.contracts.vault;
  const count = Number(await c.pub.readContract({ address: vault, abi: ABI.vault, functionName: "positionCount" }));
  const actions: { user: string; collateral: string; tx: string }[] = [];
  const alerts: { user: string; collateral: string; reason: string }[] = [];
  const SLIPPAGE_WAD = 5n * 10n ** 15n; // 0.5%, as in NightshiftVault
  for (let off = 0; off < count; off += 50) {
    const [users, cols, colls, debts] = (await c.pub.readContract({ address: vault, abi: ABI.vault, functionName: "getPositions", args: [BigInt(off), 50n] })) as [Address[], Address[], bigint[], bigint[]];
    for (let i = 0; i < users.length; i++) {
      if (debts[i] === 0n) continue;
      const [mode, trigger] = (await c.pub.readContract({ address: vault, abi: ABI.vault, functionName: "rules", args: [users[i], cols[i]] })) as [number, bigint, bigint];
      if (mode !== 2) continue;
      const hf = (await c.pub.readContract({ address: vault, abi: ABI.vault, functionName: "healthFactor", args: [users[i], cols[i]] })) as bigint;
      if (hf >= trigger || hf < WAD) continue;
      // G4 (formal/Nightshift/Guardian.lean): if the collateral at the slippage price can't cover the debt,
      // selling only lowers health, so alert instead of calling protect (the contract enforces the same rule).
      const [price] = (await c.pub.readContract({ address: DEPLOYMENT.contracts.oracle, abi: ABI.oracle, functionName: "getPrice", args: [cols[i]] })) as [bigint, number, bigint];
      const sellPrice = (price * (WAD - SLIPPAGE_WAD)) / WAD;
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
