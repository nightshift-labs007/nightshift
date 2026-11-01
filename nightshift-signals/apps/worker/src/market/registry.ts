import { eq, tokens } from "@nightshift-signals/db";
import type { Deps } from "../deps";

/**
 * Refreshes the tokens table from the official list (every 15 minutes). A token is eligible only if
 * active, its pool clears the liquidity floor, and it has a fair-value proxy.
 */
export async function syncRegistry(deps: Deps): Promise<{ eligible: number; total: number }> {
  const taxonomy = deps.taxonomy();
  const defaultBeta = new Map<string, number>();
  for (const c of Object.values(taxonomy.categories)) for (const t of c.candidates) defaultBeta.set(t, c.default_beta);

  const list = await deps.registry.list();
  let eligible = 0;
  for (const e of list) {
    const liquidity = await deps.registry.poolLiquidityUsdg(e).catch(() => null);
    const ok = e.active && !!e.proxy && liquidity !== null && Number(liquidity) >= deps.config.minPoolLiquidityUsdg;
    if (ok) eligible++;
    const [existing] = await deps.db.select({ beta: tokens.beta }).from(tokens).where(eq(tokens.symbol, e.symbol));
    const row = {
      address: e.address,
      underlyingTicker: e.underlying_ticker,
      name: e.name,
      decimals: e.decimals,
      poolAddress: e.pool_address,
      poolFee: e.pool_fee,
      poolLiquidityUsdg: liquidity,
      proxy: e.proxy,
      active: e.active,
      eligible: ok,
      updatedAt: deps.now(),
    };
    await deps.db
      .insert(tokens)
      .values({ symbol: e.symbol, ...row, beta: existing?.beta ?? String(defaultBeta.get(e.underlying_ticker) ?? 1) })
      .onConflictDoUpdate({ target: tokens.symbol, set: row });
  }
  return { eligible, total: list.length };
}
