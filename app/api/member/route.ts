import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";
import { isRegisteredWallet } from "@/lib/gates";
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
  const address = q.get("address");
  // fail closed: without a member store or email nobody can finish sign-up, so nobody counts as registered
  if (address && !signupRequired()) {
    if (!isAddress(address)) return NextResponse.json({ error: "Invalid address." }, { status: 400 });
    return NextResponse.json({ enabled: false, registered: false }, { headers: noStore });
  }
  if (!profilesEnabled()) return NextResponse.json({ enabled: false, registered: false }, { headers: noStore });
  try {
    if (address) {
      if (!isAddress(address)) return NextResponse.json({ error: "Invalid address." }, { status: 400 });
      const registered = isRegisteredWallet({ gateReady: signupRequired(), registered: await isRegistered(address).catch(() => null) });
      return NextResponse.json({ enabled: true, registered }, { headers: noStore });
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
