import "server-only";
import { createHash, randomInt, randomUUID } from "crypto";
import { dropPick, getPicks, hDel, hGet, hSet, sDel, sGet, sSet, setAdd, setMembers, setPick, type Mode } from "./store";
import { sendMail, sign, siteOrigin, verifySig } from "./mail";

/**
 * Optional accounts for the points games: sign in with an email code to keep points and streaks across browsers,
 * appear on the leaderboard under a nickname, and get reminders. Playing without an account keeps working; signing
 * in merges this browser's picks into the account.
 *
 *   play:acct:{uid}      Account JSON
 *   play:email:{hash}    uid that owns an email (sha256 of the lower-cased address)
 *   play:nick            hash nickname → uid
 *   play:accounts        set of account uids (the leaderboard and reminders walk this)
 *   play:otp:{hash}      pending code, 10 minutes
 */
export type Reminders = { open: boolean; lock: boolean; results: boolean };
export type Account = { uid: string; email: string; nick: string; createdAt: number; remind: Reminders };

const OTP_TTL = 600;
const MAX_TRIES = 5;
const NICK = /^[a-z0-9_]{3,16}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;

const norm = (email: string) => email.trim().toLowerCase();
const emailHash = (email: string) => createHash("sha256").update(norm(email)).digest("hex").slice(0, 32);
export const validEmail = (email: string) => EMAIL.test(email.trim());
export const validNick = (nick: string) => NICK.test(nick);
export const maskEmail = (email: string) => email.replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => `${a}${"•".repeat(Math.min(6, b.length))}${c}`);

export async function getAccount(uid: string | null): Promise<Account | null> {
  if (!uid) return null;
  const v = await sGet(`play:acct:${uid}`);
  try {
    return v ? (JSON.parse(v) as Account) : null;
  } catch {
    return null;
  }
}
const saveAccount = (a: Account) => sSet(`play:acct:${a.uid}`, JSON.stringify(a));
export const accountUids = () => setMembers("play:accounts");

export async function requestCode(email: string): Promise<{ ok: true; via: string } | { ok: false; error: string; status: number }> {
  if (!validEmail(email)) return { ok: false, error: "That doesn't look like an email address.", status: 400 };
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const h = emailHash(email);
  const mac = sign(`otp:${h}:${code}`);
  if (!mac) return { ok: false, error: "Sign-in isn't set up on this server yet.", status: 503 };
  await sSet(`play:otp:${h}`, JSON.stringify({ mac, tries: 0 }), OTP_TTL);
  const sent = await sendMail({
    to: norm(email),
    subject: `${code} is your Nightshift code`,
    text: `Your Nightshift sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't ask for it, you can ignore this email.`,
  });
  if (!sent.ok) {
    await sDel(`play:otp:${h}`);
    return { ok: false, error: sent.error, status: 502 };
  }
  return { ok: true, via: sent.via };
}

/** Moves this browser's picks into the account. Where both picked the same asset in the same round, the account's pick stays. */
async function mergeInto(from: string, to: string) {
  for (const mode of ["close", "ai"] as Mode[]) {
    const [src, dst] = await Promise.all([getPicks(from, mode), getPicks(to, mode)]);
    for (const [date, picks] of Object.entries(src)) {
      for (const [ticker, side] of Object.entries(picks)) {
        if (!dst[date]?.[ticker]) await setPick(to, date, ticker, side, mode); // counts +1 …
        await dropPick(from, date, ticker, mode); // … and −1, so the crowd split never double counts
      }
    }
  }
}

/**
 * Checks the code. A new email creates an account that keeps this browser's id (so nothing needs merging); a known
 * email signs in to its account and merges this browser into it. Returns the uid the cookie should hold from now on.
 */
export async function verifyCode(
  email: string,
  code: string,
  deviceUid: string | null,
  nick?: string,
): Promise<{ ok: true; uid: string; account: Account; created: boolean } | { ok: false; error: string; status: number }> {
  const h = emailHash(email);
  const raw = await sGet(`play:otp:${h}`);
  if (!raw) return { ok: false, error: "That code has expired. Ask for a new one.", status: 400 };
  const otp = JSON.parse(raw) as { mac: string; tries: number };
  if (otp.tries >= MAX_TRIES) return { ok: false, error: "Too many tries. Ask for a new code.", status: 429 };
  if (!/^\d{6}$/.test(code) || !verifySig(`otp:${h}:${code}`, otp.mac)) {
    await sSet(`play:otp:${h}`, JSON.stringify({ ...otp, tries: otp.tries + 1 }), OTP_TTL);
    return { ok: false, error: "That code isn't right.", status: 400 };
  }
  await sDel(`play:otp:${h}`);

  const owner = await sGet(`play:email:${h}`);
  if (owner) {
    const account = await getAccount(owner);
    if (account) {
      if (deviceUid && deviceUid !== owner) await mergeInto(deviceUid, owner);
      return { ok: true, uid: owner, account, created: false };
    }
  }
  // new account: pick a nickname (asked for, or generated), unique
  let name = (nick ?? "").trim().toLowerCase();
  if (name && !validNick(name)) return { ok: false, error: "Nicknames are 3–16 characters: a–z, 0–9 and _.", status: 400 };
  if (name && (await hGet("play:nick", name))) return { ok: false, error: "That nickname is taken. Try another.", status: 409 };
  for (let i = 0; !name && i < 20; i++) {
    const n = `player_${randomInt(1000, 99999)}`;
    if (!(await hGet("play:nick", n))) name = n;
  }
  const uid = deviceUid ?? randomUUID();
  const account: Account = { uid, email: norm(email), nick: name, createdAt: Date.now(), remind: { open: false, lock: false, results: false } };
  await saveAccount(account);
  await sSet(`play:email:${h}`, uid);
  await hSet("play:nick", name, uid);
  await setAdd("play:accounts", uid);
  return { ok: true, uid, account, created: true };
}

export async function setReminders(uid: string, remind: Reminders): Promise<Account | null> {
  const a = await getAccount(uid);
  if (!a) return null;
  a.remind = { open: !!remind.open, lock: !!remind.lock, results: !!remind.results };
  await saveAccount(a);
  return a;
}

export async function renameNick(uid: string, next: string): Promise<{ ok: true; account: Account } | { ok: false; error: string; status: number }> {
  const a = await getAccount(uid);
  if (!a) return { ok: false, error: "Sign in first.", status: 401 };
  const n = next.trim().toLowerCase();
  if (!validNick(n)) return { ok: false, error: "Nicknames are 3–16 characters: a–z, 0–9 and _.", status: 400 };
  const owner = await hGet("play:nick", n);
  if (owner && owner !== uid) return { ok: false, error: "That nickname is taken. Try another.", status: 409 };
  await hDel("play:nick", a.nick);
  await hSet("play:nick", n, uid);
  a.nick = n;
  await saveAccount(a);
  return { ok: true, account: a };
}

/**
 * One-click unsubscribe link for reminder emails (signed, no login needed). It names the account by its email hash,
 * never by the uid: the uid is what the cookie holds, so it must not travel in links.
 */
export function unsubscribeUrl(email: string): string | null {
  const h = emailHash(email);
  const t = sign(`unsub:${h}`);
  return t ? `${siteOrigin()}/api/play/unsubscribe?h=${h}&t=${t}` : null;
}

/** Turns every reminder off for the account behind a valid unsubscribe link. */
export async function unsubscribe(h: string, t: string): Promise<boolean> {
  if (!/^[0-9a-f]{32}$/.test(h) || !verifySig(`unsub:${h}`, t)) return false;
  const uid = await sGet(`play:email:${h}`);
  if (!uid) return false;
  return !!(await setReminders(uid, { open: false, lock: false, results: false }));
}
