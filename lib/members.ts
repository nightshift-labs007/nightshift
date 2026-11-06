import "server-only";
import { createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from "crypto";
import { env } from "./env";
import { kvDel, kvGet, kvHDel, kvHGetAll, kvHIncrBy, kvHSet, kvHSetNX, kvSAdd, kvSMembers, kvSet, kvSetEx, kvSetNX } from "./kv";
import { normalizeInvite, type Membership, type Profile } from "./profile-shared";

/**
 * Sign-up for Nightshift, stored privately in Upstash Redis next to profiles:
 *   connect a wallet   → counted as a user (users:seen)
 *   invite code        → redeemed once per wallet; each code has a use limit
 *   email              → verified with a 6-digit code sent through Resend
 *   username + profile → the wallet is registered (members)
 * Only the server writes these records; the profile API can't set them.
 */
const SEEN = "users:seen"; // address → first connected (ms)
const MEMBERS = "members"; // address → registered (ms)
const INVITES = "invites"; // set of codes
const memberKey = (a: string) => `member:${a.toLowerCase()}`;
const inviteKey = (c: string) => `invite:${c}`;
const inviteUsesKey = (c: string) => `invite-uses:${c}`;
const usernameKey = (u: string) => `username:${u.toLowerCase()}`;
const emailKey = (e: string) => `email-owner:${e.toLowerCase()}`;
const otpKey = (a: string) => `otp:${a.toLowerCase()}`;
const passwordKey = (a: string) => `pw:${a.toLowerCase()}`; // scrypt$N$salt$hash, never the password itself
const EMAIL_STATUS = "email:last"; // the last send: ok, or the provider's reason it failed

type MemberRecord = { invite?: string; inviteAt?: number; email?: string; emailAt?: number };
export type Invite = { code: string; max: number; used: number; note: string; createdAt: number; usedBy: string[] };

const OTP_TTL_SEC = 600;
const OTP_MAX_ATTEMPTS = 5;
const hmac = (data: string) => createHmac("sha256", createHmac("sha256", env.cronSecret).update("nightshift-email-otp").digest()).update(data).digest("base64url");

export async function markSeen(address: string) {
  return (await kvHSetNX(SEEN, address.toLowerCase(), String(Date.now()))) === 1;
}

export async function getMember(address: string): Promise<MemberRecord> {
  const raw = await kvGet(memberKey(address));
  return raw ? (JSON.parse(raw) as MemberRecord) : {};
}
const putMember = (address: string, m: MemberRecord) => kvSet(memberKey(address), JSON.stringify(m));

export async function membership(address: string, profile: Profile | null): Promise<Membership> {
  const [m, all, pw] = await Promise.all([getMember(address), kvHGetAll(MEMBERS), kvGet(passwordKey(address))]);
  const at = all[address.toLowerCase()];
  return { invite: !!m.invite, email: m.email ?? null, registered: !!(at && m.invite && m.email && profile?.username), registeredAt: at ? Number(at) : null, hasPassword: !!pw };
}

/** Everyone who connected a wallet, and everyone registered: address → time (ms). For the leaderboard. */
export async function people() {
  const [seen, members] = await Promise.all([kvHGetAll(SEEN), kvHGetAll(MEMBERS)]);
  return { seen, members };
}

export async function isRegistered(address: string) {
  return !!(await kvHGetAll(MEMBERS))[address.toLowerCase()];
}

// ---------------------------------------------------------------- invite codes

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I
export const showInvite = (c: string) => `NS-${c.slice(0, 4)}-${c.slice(4)}`;

export async function createInvites(count: number, maxUses: number, note: string): Promise<string[]> {
  const codes: string[] = [];
  while (codes.length < count) {
    const code = Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join("");
    if (!(await kvHSetNX(inviteKey(code), "max", String(maxUses)))) continue; // that code already exists
    await Promise.all([
      kvHSet(inviteKey(code), "used", "0"),
      kvHSet(inviteKey(code), "note", note.slice(0, 80)),
      kvHSet(inviteKey(code), "createdAt", String(Date.now())),
      kvSAdd(INVITES, code),
    ]);
    codes.push(showInvite(code));
  }
  return codes;
}

export async function listInvites(): Promise<Invite[]> {
  const codes = await kvSMembers(INVITES);
  const out = await Promise.all(
    codes.map(async (code) => {
      const [h, uses] = await Promise.all([kvHGetAll(inviteKey(code)), kvHGetAll(inviteUsesKey(code))]);
      return { code: showInvite(code), max: Number(h.max ?? 0), used: Number(h.used ?? 0), note: h.note ?? "", createdAt: Number(h.createdAt ?? 0), usedBy: Object.keys(uses) };
    }),
  );
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** Whether an invite code exists and still has a free seat, without using one. Returns the normalised code. */
export async function checkInvite(input: string): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const code = normalizeInvite(input);
  if (!/^[A-Z0-9]{8}$/.test(code)) return { ok: false, error: "Invite codes look like NS-XXXX-XXXX." };
  const h = await kvHGetAll(inviteKey(code));
  if (!h.max) return { ok: false, error: "That invite code doesn't exist. Check it and try again." };
  if (Number(h.used ?? 0) >= Number(h.max)) return { ok: false, error: "That invite code has already been used up." };
  return { ok: true, code };
}

/** Uses one seat of an invite code for this wallet. Safe to repeat: a wallet only ever uses one code. */
export async function redeemInvite(address: string, input: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const m = await getMember(address);
  if (m.invite) return { ok: true };
  const code = normalizeInvite(input);
  if (!/^[A-Z0-9]{8}$/.test(code)) return { ok: false, error: "Invite codes look like NS-XXXX-XXXX." };
  const h = await kvHGetAll(inviteKey(code));
  if (!h.max) return { ok: false, error: "That invite code doesn't exist. Check it and try again." };
  // take a seat atomically; give it back if the code was already full
  const used = await kvHIncrBy(inviteKey(code), "used", 1);
  if (used > Number(h.max)) {
    await kvHIncrBy(inviteKey(code), "used", -1);
    return { ok: false, error: "That invite code has already been used up." };
  }
  await kvHSet(inviteUsesKey(code), address.toLowerCase(), String(Date.now()));
  await putMember(address, { ...m, invite: code, inviteAt: Date.now() });
  return { ok: true };
}

// ---------------------------------------------------------------- email one-time codes

export const emailEnabled = () => !!(env.resendKey && env.resendFrom);

/** The last email send (no addresses or codes): for /api/health. */
export async function emailStatus() {
  const raw = await kvGet(EMAIL_STATUS).catch(() => null);
  const sender = env.resendFrom.match(/@([^>\s]+)/)?.[1] ?? null;
  return { senderDomain: sender, keyLooksValid: /^re_[A-Za-z0-9_]{20,}$/.test(env.resendKey), last: raw ? JSON.parse(raw) : null };
}
/** Invite-only sign-up is enforced (App wallet tools, faucet) once both the store and email are configured. */
export const signupRequired = () => !!(env.upstashUrl && env.upstashToken && env.cronSecret.length >= 16) && emailEnabled();

/**
 * Whether this wallet may get a code for this email (checked before any rate limit is spent). The email code is the
 * sign-in: no wallet signature. So without a session, a wallet that already has a verified email can only get a code at
 * that same email (signing back in); changing the email needs a session. A new wallet brings an invite code, which is
 * checked here and used only once the email code is verified.
 */
export async function canSendEmailCode(
  address: string,
  email: string,
  opts: { signedIn: boolean; invite?: string },
): Promise<{ ok: true; invite?: string } | { ok: false; error: string; status: number }> {
  const m = await getMember(address);
  if (!opts.signedIn && m.email && m.email !== email)
    return { ok: false, error: "This wallet is registered with a different email. Use that email to sign in.", status: 403 };
  const owner = await kvGet(emailKey(email));
  if (owner && owner !== address.toLowerCase()) return { ok: false, error: "That email is already linked to another wallet.", status: 409 };
  if (m.invite) return { ok: true };
  if (!opts.invite) return { ok: false, error: "Enter your invite code.", status: 403 };
  const inv = await checkInvite(opts.invite);
  return inv.ok ? { ok: true, invite: inv.code } : { ok: false, error: inv.error, status: 400 };
}

/** Sends a 6-digit code to the email. Call canSendEmailCode first; `invite` is used when the code is verified. */
export async function sendEmailCode(address: string, email: string, invite?: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await kvSetEx(otpKey(address), JSON.stringify({ email, invite, hash: hmac(`${address.toLowerCase()}:${email}:${code}`), attempts: 0 }), OTP_TTL_SEC);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.resendFrom,
      to: [email],
      subject: `${code} is your Nightshift code`,
      text: `Your Nightshift verification code is ${code}\n\nIt expires in 10 minutes. If you didn't ask for it, you can ignore this email.`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:auto;padding:24px;color:#111">
<p style="margin:0 0 6px;font-size:13px;letter-spacing:.08em;color:#666">NIGHTSHIFT</p>
<p style="margin:0 0 18px;font-size:16px">Your verification code:</p>
<p style="margin:0 0 18px;font-size:34px;font-weight:700;letter-spacing:.3em;font-family:ui-monospace,monospace">${code}</p>
<p style="margin:0;font-size:13px;color:#666">It expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p></div>`,
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) {
    await kvDel(otpKey(address));
    const j = (await res?.json().catch(() => null)) as { message?: string } | null;
    const reason = (j?.message ?? (res ? `HTTP ${res.status}` : "no response")).slice(0, 200);
    console.error("resend:", res?.status, reason);
    // kept for /api/health, so a misconfigured key or sender shows up without digging through logs
    await kvSetEx(EMAIL_STATUS, JSON.stringify({ ok: false, at: new Date().toISOString(), status: res?.status ?? null, reason }), 7 * 86400).catch(() => {});
    return { ok: false, error: "We couldn't send the email right now. Please try again in a minute.", status: 502 };
  }
  await kvSetEx(EMAIL_STATUS, JSON.stringify({ ok: true, at: new Date().toISOString() }), 7 * 86400).catch(() => {});
  return { ok: true };
}

export async function verifyEmailCode(address: string, code: string): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const raw = await kvGet(otpKey(address));
  if (!raw) return { ok: false, error: "That code has expired. Send a new one." };
  const otp = JSON.parse(raw) as { email: string; invite?: string; hash: string; attempts: number };
  if (otp.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, error: "Too many wrong tries. Send a new code." };
  const want = Buffer.from(otp.hash);
  const got = Buffer.from(hmac(`${address.toLowerCase()}:${otp.email}:${String(code).replace(/\D/g, "")}`));
  if (want.length !== got.length || !timingSafeEqual(want, got)) {
    await kvSetEx(otpKey(address), JSON.stringify({ ...otp, attempts: otp.attempts + 1 }), OTP_TTL_SEC);
    const left = OTP_MAX_ATTEMPTS - otp.attempts - 1;
    return { ok: false, error: left > 0 ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : "That code isn't right. Send a new one." };
  }
  // one email per wallet: claim it, then release the wallet's previous email
  if (!(await kvSetNX(emailKey(otp.email), address.toLowerCase())) && (await kvGet(emailKey(otp.email))) !== address.toLowerCase())
    return { ok: false, error: "That email is already linked to another wallet." };
  // a new wallet's invite code takes its seat only now, once the email is proven
  if (otp.invite) {
    const r = await redeemInvite(address, otp.invite);
    if (!r.ok) {
      if ((await kvGet(emailKey(otp.email))) === address.toLowerCase() && !(await getMember(address)).email) await kvDel(emailKey(otp.email));
      return { ok: false, error: r.error };
    }
  }
  const m = await getMember(address);
  if (m.email && m.email !== otp.email) await kvDel(emailKey(m.email));
  await putMember(address, { ...m, email: otp.email, emailAt: Date.now() });
  await kvDel(otpKey(address));
  return { ok: true, email: otp.email };
}

// ---------------------------------------------------------------- usernames and registration

export async function usernameOwner(username: string) {
  return kvGet(usernameKey(username));
}

/** Claims `next` for this wallet, releasing `prev`. False when another wallet has it. */
export async function claimUsername(address: string, next: string, prev?: string) {
  const a = address.toLowerCase();
  if (prev === next) return true;
  if (!(await kvSetNX(usernameKey(next), a)) && (await kvGet(usernameKey(next))) !== a) return false;
  if (prev) await kvDel(usernameKey(prev));
  return true;
}

export async function markRegistered(address: string) {
  await kvHSetNX(MEMBERS, address.toLowerCase(), String(Date.now()));
}

/** Undoes registration when a profile is deleted: frees the username and email. The invite stays used. */
export async function releaseMember(address: string, profile: Profile | null) {
  const m = await getMember(address);
  if (profile?.username && (await usernameOwner(profile.username)) === address.toLowerCase()) await kvDel(usernameKey(profile.username));
  if (m.email) await kvDel(emailKey(m.email));
  await putMember(address, { invite: m.invite, inviteAt: m.inviteAt });
  await kvHDel(MEMBERS, address.toLowerCase());
  await kvDel(passwordKey(address));
}

// ---------------------------------------------------------------- Nightshift wallets (Privy email login)

/**
 * Links an email that Privy has already verified to a wallet: claims the one-email-per-wallet lock and records it.
 * Returns false when the email belongs to another wallet (the caller moves that member over instead).
 */
export async function bindVerifiedEmail(address: string, email: string): Promise<boolean> {
  const a = address.toLowerCase();
  if (!(await kvSetNX(emailKey(email), a)) && (await kvGet(emailKey(email))) !== a) return false;
  const m = await getMember(a);
  if (m.email && m.email !== email) await kvDel(emailKey(m.email));
  await putMember(a, { ...m, email, emailAt: Date.now() });
  return true;
}

/** The wallet a verified email is linked to, if any. */
export async function emailOwner(email: string) {
  return kvGet(emailKey(email));
}

/**
 * Moves a member (invite, email, username, profile, registration time) from an old wallet to their new Nightshift wallet,
 * when they log in with the same verified email. The old wallet keeps its on-chain history but stops being a member.
 */
export async function moveMember(from: string, to: string, profile: Profile | null): Promise<void> {
  const [f, t] = [from.toLowerCase(), to.toLowerCase()];
  const m = await getMember(f);
  const registeredAt = (await kvHGetAll(MEMBERS))[f];
  if (profile?.username) {
    if ((await usernameOwner(profile.username)) === f) await kvSet(usernameKey(profile.username), t);
  }
  await kvSet(emailKey(m.email!), t);
  await putMember(t, { invite: m.invite, inviteAt: m.inviteAt, email: m.email, emailAt: Date.now() });
  if (registeredAt) {
    await kvHSetNX(MEMBERS, t, registeredAt);
    await kvHDel(MEMBERS, f);
  }
  await putMember(f, {}); // the old wallet keeps nothing: no invite, no email
}

// ---------------------------------------------------------------- passwords (sign in without an email code)

const SCRYPT_N = 16384;
const derive = (password: string, salt: Buffer, n = SCRYPT_N) =>
  new Promise<Buffer>((res, rej) => scrypt(password.normalize("NFKC"), salt, 64, { N: n, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));

/** Stores a salted scrypt hash of the password for this wallet (replacing any earlier one). */
export async function setPassword(address: string, password: string) {
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  await kvSet(passwordKey(address), `scrypt$${SCRYPT_N}$${salt.toString("base64url")}$${hash.toString("base64url")}`);
}

/** Checks a password against the stored hash in constant time. False when there is no password yet. */
export async function checkPassword(address: string, password: string): Promise<boolean> {
  const stored = await kvGet(passwordKey(address));
  if (!stored) return false;
  const [kind, n, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64url");
  const got = await derive(password, Buffer.from(salt, "base64url"), Number(n) || SCRYPT_N);
  return want.length === got.length && timingSafeEqual(want, got);
}

export async function hasPassword(address: string) {
  return !!(await kvGet(passwordKey(address)));
}
