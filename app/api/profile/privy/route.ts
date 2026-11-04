import { NextResponse, type NextRequest } from "next/server";
import { PrivyClient } from "@privy-io/server-auth";
import { env } from "@/lib/env";
import { bindVerifiedEmail, checkInvite, emailOwner, getMember, membership, moveMember, redeemInvite } from "@/lib/members";
import { SESSION_COOKIE, SESSION_DAYS, deleteProfile, getProfile, makeSession, profilesEnabled, saveProfile } from "@/lib/profile";
import { allow } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

let client: PrivyClient | null = null;
const privy = () => (client ??= new PrivyClient(env.privyAppId, env.privySecret));

/**
 * Sign-up and sign-in with a Nightshift wallet (Privy email login). The browser sends its Privy access token; the server
 * verifies it with Privy, reads the user's verified email and their Privy-created wallet, and only then:
 * - a new wallet: uses the invite code and links the email (one email per wallet);
 * - a member who signed up earlier with another wallet and the same email: moves their membership to the new wallet;
 * - a returning member: just signs in.
 * It then sets the 7-day session for that wallet. Nothing here trusts an address or email sent by the browser.
 */
export async function POST(req: NextRequest) {
  if (!profilesEnabled()) return NextResponse.json({ error: "Sign-up isn't switched on yet." }, { status: 503 });
  if (!env.privySecret) return NextResponse.json({ error: "Email wallets aren't switched on yet." }, { status: 503 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (!(await allow(`privy:ip:${ip}`, 30, 3600)).ok) return NextResponse.json({ error: "Too many tries. Please try again later." }, { status: 429 });
  const { token, invite } = (await req.json().catch(() => ({}))) as { token?: string; invite?: string };
  if (!token) return NextResponse.json({ error: "Log in with your email first." }, { status: 401 });

  let email: string, wallet: string;
  try {
    const { userId } = await privy().verifyAuthToken(token);
    const user = await privy().getUser(userId);
    const e = user.linkedAccounts.find((a) => a.type === "email") as { address?: string } | undefined;
    const w = user.linkedAccounts.find((a) => a.type === "wallet" && (a as { walletClientType?: string }).walletClientType === "privy" && (a as { chainType?: string }).chainType === "ethereum") as
      | { address?: string }
      | undefined;
    if (!e?.address || !w?.address) return NextResponse.json({ error: "Your Nightshift wallet isn't ready yet. Please try again in a moment." }, { status: 409 });
    email = e.address.trim().toLowerCase();
    wallet = w.address.toLowerCase();
  } catch {
    return NextResponse.json({ error: "Your login has expired. Please log in again." }, { status: 401 });
  }

  try {
    const m = await getMember(wallet);
    if (m.email && m.email !== email) return NextResponse.json({ error: "This wallet is linked to a different email." }, { status: 403 });
    if (!m.email) {
      const owner = await emailOwner(email);
      if (owner && owner !== wallet) {
        // signed up before with another wallet and this same (now Privy-verified) email: bring the membership over
        const profile = await getProfile(owner);
        await moveMember(owner, wallet, profile);
        if (profile) {
          await saveProfile(wallet, profile);
          await deleteProfile(owner);
        }
      } else {
        if (!m.invite) {
          if (!invite) return NextResponse.json({ error: "Enter your invite code.", needInvite: true }, { status: 403 });
          if (!(await allow(`invite:ip:${ip}`, 30, 3600)).ok) return NextResponse.json({ error: "Too many tries. Please wait an hour and try again." }, { status: 429 });
          const ok = await checkInvite(invite);
          if (!ok.ok) return NextResponse.json({ error: ok.error }, { status: 400 });
          const r = await redeemInvite(wallet, ok.code);
          if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
        }
        if (!(await bindVerifiedEmail(wallet, email))) return NextResponse.json({ error: "That email is already linked to another wallet." }, { status: 409 });
      }
    }
    const res = NextResponse.json({ ok: true, address: wallet, member: await membership(wallet, await getProfile(wallet)) });
    res.cookies.set(SESSION_COOKIE, makeSession(wallet), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86400 });
    return res;
  } catch (e) {
    console.error("privy sign-in failed", e);
    return NextResponse.json({ error: "Couldn't sign you in right now. Please try again." }, { status: 503 });
  }
}
