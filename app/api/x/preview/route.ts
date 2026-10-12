import { NextResponse } from "next/server";
import { xConfigured, xLength, xPostingOn } from "@/lib/x";
import { SLOTS, draft, type Slot } from "@/lib/xagent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** What the X agent would post for each slot right now. Never posts, never calls X. */
export async function GET() {
  const slots = await Promise.all(
    (Object.keys(SLOTS) as Slot[]).map(async (slot) => {
      const s = SLOTS[slot];
      const when = `${s.days.length === 5 ? "Mon-Fri" : s.days.join(", ")} ${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")} ET`;
      try {
        const d = await draft(slot);
        return "skip" in d ? { slot, when, what: s.what, skip: d.skip } : { slot, when, what: s.what, chars: xLength(d.text), text: d.text };
      } catch (e) {
        return { slot, when, what: s.what, error: String(e).slice(0, 200) };
      }
    }),
  );
  return NextResponse.json({ account: "@nightshift_si", configured: xConfigured(), posting: xPostingOn(), slots });
}
