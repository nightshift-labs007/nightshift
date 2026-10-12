import { NextResponse, type NextRequest } from "next/server";
import { xConfigured, xLength, xPostingOn } from "@/lib/x";
import { SLOTS, draft, type Slot } from "@/lib/xagent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const when = (slot: Slot) => {
  const s = SLOTS[slot];
  if (s.every) return `every ${s.every} min`;
  return `${s.days.length === 5 ? "Mon-Fri" : s.days.join(", ")} ${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")} ET`;
};

/** What the X agent would post right now (?theorems=1: the next 24 theorem posts). Never posts, never calls X. */
export async function GET(req: NextRequest) {
  const show = async (slot: Slot, now?: number) => {
    try {
      const d = await draft(slot, now);
      return "skip" in d ? { slot, skip: d.skip } : { slot, chars: xLength(d.text), text: d.text };
    } catch (e) {
      return { slot, error: String(e).slice(0, 200) };
    }
  };
  if (req.nextUrl.searchParams.get("theorems") === "1") {
    const now = Date.now();
    return NextResponse.json({ theorems: await Promise.all(Array.from({ length: 24 }, (_, k) => show("theorem", now + k * 20 * 60_000))) });
  }
  const slots = await Promise.all((Object.keys(SLOTS) as Slot[]).map(async (slot) => ({ when: when(slot), what: SLOTS[slot].what, ...(await show(slot)) })));
  return NextResponse.json({ account: "@nightshift_si", configured: xConfigured(), posting: xPostingOn(), slots });
}
