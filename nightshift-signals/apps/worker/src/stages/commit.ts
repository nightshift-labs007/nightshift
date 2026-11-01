import { basketHash } from "@nightshift-signals/chain";
import { makeEvent, type Envelope } from "@nightshift-signals/core";
import { and, basketLegs, baskets, commits, eq, isNotNull, rowsToBasket } from "@nightshift-signals/db";
import type { Deps } from "../deps";

export const COMMITTER = "committer";

export async function loadBasket(deps: Deps, id: string) {
  const [row] = await deps.db.select().from(baskets).where(eq(baskets.id, id));
  if (!row) return null;
  const legs = await deps.db.select().from(basketLegs).where(eq(basketLegs.basketId, id));
  return { row, basket: rowsToBasket(row, legs) };
}

/** Hashes the canonical JSON and writes it onchain before anyone sees the basket. */
export async function onBasketSized(deps: Deps, e: Envelope<"basket.sized">): Promise<void> {
  if (e.payload.voided) return;
  const loaded = await loadBasket(deps, e.payload.basket_id);
  if (!loaded || loaded.row.status !== "draft") return;
  const hash = basketHash(loaded.basket);

  const [existing] = await deps.db.select().from(commits).where(eq(commits.basketId, loaded.row.id));
  if (existing?.txHash) return emitCommitted(deps, existing, loaded.row.eventId);

  await deps.db.update(baskets).set({ canonicalHash: hash }).where(eq(baskets.id, loaded.row.id));
  await deps.db.insert(commits).values({ basketId: loaded.row.id, hash, chainId: deps.ledger.chainId, status: "pending" }).onConflictDoNothing();

  const r = await deps.ledger.commit(loaded.row.id, hash, deps.config.commitWaitMs);
  const [row] = await deps.db
    .update(commits)
    .set({ txHash: r.txHash, status: r.status, blockNumber: r.blockNumber, blockTime: r.blockTime, confirmedAt: r.status === "confirmed" ? deps.now() : null })
    .where(eq(commits.basketId, loaded.row.id))
    .returning();
  if (r.status === "confirmed") await deps.db.update(baskets).set({ commitTx: r.txHash }).where(eq(baskets.id, loaded.row.id));
  await emitCommitted(deps, row!, loaded.row.eventId);
}

async function emitCommitted(deps: Deps, c: typeof commits.$inferSelect, eventId: string) {
  await deps.bus.publish(
    makeEvent(
      "basket.committed",
      { basket_id: c.basketId, hash: c.hash, tx_hash: c.txHash, status: c.status, block_time: c.blockTime?.toISOString() ?? null },
      { producer: COMMITTER, correlation_id: eventId, now: deps.now() },
    ),
  );
}

/** Attaches the tx to baskets that were published pending, once the chain catches up. */
export async function reconcileCommits(deps: Deps): Promise<number> {
  const pending = await deps.db.select().from(commits).where(and(eq(commits.status, "pending"), isNotNull(commits.txHash)));
  let done = 0;
  for (const c of pending) {
    const r = await deps.ledger.receipt(c.txHash as `0x${string}`).catch(() => null);
    if (r?.status !== "confirmed") continue;
    await deps.db
      .update(commits)
      .set({ status: "confirmed", blockNumber: r.blockNumber, blockTime: r.blockTime, confirmedAt: deps.now() })
      .where(eq(commits.basketId, c.basketId));
    await deps.db.update(baskets).set({ commitTx: r.txHash }).where(eq(baskets.id, c.basketId));
    done++;
  }
  return done;
}
