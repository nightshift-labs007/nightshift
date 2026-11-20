import "server-only";
import type { PickResult, Side } from "@/lib/play-rules";
import { getAccount } from "./account";
import { sign, siteOrigin, verifySig } from "./mail";
import { playerSummary } from "./state";
import type { Mode } from "./store";

/**
 * Shareable result cards. The card's content is built on the server from the player's real picks and results and
 * signed, so the numbers in a shared link can't be edited (a changed link fails the signature and shows nothing).
 * It carries a nickname (or "A Nightshift player"), never an email or the player's id.
 */
export type ShareCard = {
  v: 1;
  n: string | null; // nickname
  m: Mode;
  d: string; // round date
  s: string; // the open it's decided by
  p: [string, Side, PickResult][];
  st: number; // streak at the time of sharing (up/down game)
};

const enc = (x: unknown) => Buffer.from(JSON.stringify(x)).toString("base64url");

export async function makeShare(uid: string, mode: Mode, date: string, now: number): Promise<{ url: string; text: string } | null> {
  const [s, a] = await Promise.all([playerSummary(uid, now), getAccount(uid)]);
  const h = s.history.find((x) => x.mode === mode && x.date === date);
  if (!h) return null;
  const card: ShareCard = { v: 1, n: a?.nick ?? null, m: mode, d: h.date, s: h.settleDate, p: h.picks.map((p) => [p.ticker, p.side, p.result]), st: s.close?.streak ?? 0 };
  const body = enc(card);
  const sig = sign(`share:${body}`);
  if (!sig) return null;
  const right = card.p.filter((x) => x[2] === "win").length;
  const decided = card.p.filter((x) => x[2] === "win" || x[2] === "loss").length;
  const text =
    h.status === "settled"
      ? `I called ${right} of ${decided} on Nightshift's free ${mode === "ai" ? "Beat the AI" : "up-or-down"} game.`
      : `My calls for the next open on Nightshift's free ${mode === "ai" ? "Beat the AI" : "up-or-down"} game.`;
  return { url: `${siteOrigin()}/s/${body}.${sig}`, text };
}

export function readShare(token: string): ShareCard | null {
  const [body, sig] = decodeURIComponent(token).split(".");
  if (!body || !sig || !verifySig(`share:${body}`, sig)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString()) as ShareCard;
    return c?.v === 1 && Array.isArray(c.p) ? c : null;
  } catch {
    return null;
  }
}
