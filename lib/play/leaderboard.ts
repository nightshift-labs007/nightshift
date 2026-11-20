import "server-only";
import { rankBoard, type BoardRow } from "@/lib/play-rules";
import { accountUids, getAccount } from "./account";
import { playerSummary } from "./state";

/**
 * Leaderboard for the points games: signed-in players only, by nickname (never email or id). Computed from picks and
 * results on demand and cached for a minute. Fine for hundreds of players; past that, keep running totals updated at
 * settlement instead (noted in PROGRESS.md).
 */
export type Board = { at: number; week: BoardRow[]; all: BoardRow[]; players: number };
const g = globalThis as unknown as { __playBoard?: { at: number; board: Board } };

export async function leaderboard(now: number, fresh = false): Promise<Board> {
  if (!fresh && g.__playBoard && Date.now() - g.__playBoard.at < 60_000) return g.__playBoard.board;
  const uids = await accountUids();
  const cache = new Map();
  const rows = (
    await Promise.all(
      uids.map(async (uid): Promise<BoardRow | null> => {
        const a = await getAccount(uid);
        if (!a) return null;
        const s = await playerSummary(uid, now, cache);
        const w = (s.close?.wins ?? 0) + (s.ai?.wins ?? 0);
        const l = (s.close?.losses ?? 0) + (s.ai?.losses ?? 0);
        const rounds = Object.keys(s.close?.byRound ?? {}).length + Object.keys(s.ai?.byRound ?? {}).length + (s.close?.pending ?? 0) + (s.ai?.pending ?? 0);
        return { nick: a.nick, points: s.points, week: s.week, accuracy: w + l ? w / (w + l) : null, streak: s.close?.streak ?? 0, rounds };
      }),
    )
  ).filter((r): r is BoardRow => !!r);
  const board: Board = { at: now, week: rankBoard(rows, "week").slice(0, 25), all: rankBoard(rows, "points").slice(0, 25), players: rows.length };
  g.__playBoard = { at: Date.now(), board };
  return board;
}
