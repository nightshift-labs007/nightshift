import { makeEvent } from "@nightshift-signals/core";
import type { FairValueService } from "@nightshift-signals/db";
import type { Deps } from "../deps";

const REALERT_MS = 30 * 60 * 1000;

/** Every minute: alert when a token sits more than driftAlertBps from fair value (once per 30 min per symbol). */
export class DriftWatcher {
  private lastAlert = new Map<string, number>();
  constructor(
    private deps: Deps,
    private fv: FairValueService,
  ) {}

  async check(): Promise<number> {
    const now = this.deps.now();
    let sent = 0;
    for (const g of (await this.fv.all()).values()) {
      if (g.frozen || Math.abs(g.gap_bps) <= this.deps.config.driftAlertBps) continue;
      if (now.getTime() - (this.lastAlert.get(g.symbol) ?? 0) < REALERT_MS) continue;
      this.lastAlert.set(g.symbol, now.getTime());
      await this.deps.bus.publish(
        makeEvent(
          "alert.drift",
          { symbol: g.symbol, px: g.mid, fv: g.fv, gap_bps: g.gap_bps, frozen: g.frozen, ts: now.toISOString() },
          { producer: "fairvalue", correlation_id: g.symbol, now },
        ),
      );
      sent++;
    }
    return sent;
  }
}
