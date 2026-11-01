import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";
import { isRegistered, signupRequired, usernameOwner } from "@/lib/members";
import { profilesEnabled } from "@/lib/profile";
import { USERNAME } from "@/lib/profile-shared";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

/**
 * Public sign-up status: ?address=0x… says whether that wallet finished sign-up (the App uses it to open the
 * wallet tools); ?username=… says whether a username is still free.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  if (!profilesEnabled()) return NextResponse.json({ enabled: false, registered: true }, { headers: noStore }); // no store: nothing to gate
  try {
    const address = q.get("address");
    if (address) {
      if (!isAddress(address)) return NextResponse.json({ error: "Invalid address." }, { status: 400 });
      // until email sending is configured nobody could finish sign-up, so the gate stays open
      if (!signupRequired()) return NextResponse.json({ enabled: false, registered: true }, { headers: noStore });
      return NextResponse.json({ enabled: true, registered: await isRegistered(address) }, { headers: noStore });
    }
    const username = (q.get("username") ?? "").toLowerCase();
    if (username) {
      if (!USERNAME.test(username)) return NextResponse.json({ available: false, reason: "3 to 20 lowercase letters, numbers or underscores." }, { headers: noStore });
      const owner = await usernameOwner(username);
      const mine = q.get("for")?.toLowerCase();
      return NextResponse.json({ available: !owner || owner === mine }, { headers: noStore });
    }
    return NextResponse.json({ error: "Pass ?address= or ?username=" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "The member store is unavailable right now." }, { status: 503 });
  }
}
