import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { env } from "./env";
import { kvDel, kvEnabled, kvGet, kvMGet, kvSet } from "./kv";
import type { Profile, PublicProfile } from "./profile-shared";

/**
 * Wallet profiles, stored privately in Upstash Redis (never on a public chain, so they can be edited and deleted).
 * Editing needs a session: the wallet signs a free message once, and the server sets an HttpOnly cookie signed with
 * a key derived from CRON_SECRET, valid for 7 days.
 */
export const SESSION_COOKIE = "ns_session";
export const SESSION_DAYS = 7;
const key = (a: string) => `profile:${a.toLowerCase()}`;
// the photo lives apart from the profile, so reading profiles (the leaderboard) never pulls image data
const avatarKey = (a: string) => `avatar:${a.toLowerCase()}`;
const avatarAtKey = (a: string) => `avatar-at:${a.toLowerCase()}`;

export const profilesEnabled = () => kvEnabled() && env.cronSecret.length >= 16;

const hmac = (data: string) => createHmac("sha256", createHmac("sha256", env.cronSecret).update("nightshift-profile-session").digest()).update(data).digest("base64url");

export function makeSession(address: string) {
  const body = `${address.toLowerCase()}.${Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400}`;
  return `${body}.${hmac(body)}`;
}

/** The address a session cookie belongs to, or null if it's missing, forged or expired. */
export function readSession(cookie: string | undefined): string | null {
  if (!cookie || !env.cronSecret) return null;
  const [addr, exp, sig] = cookie.split(".");
  if (!addr || !exp || !sig || !/^0x[0-9a-f]{40}$/.test(addr)) return null;
  const want = Buffer.from(hmac(`${addr}.${exp}`));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return Number(exp) > Date.now() / 1000 ? addr : null;
}

export async function getProfile(address: string): Promise<Profile | null> {
  const raw = await kvGet(key(address));
  return raw ? (JSON.parse(raw) as Profile) : null;
}

export async function saveProfile(address: string, p: Profile): Promise<Profile> {
  const saved = { ...p, updatedAt: new Date().toISOString() };
  await kvSet(key(address), JSON.stringify(saved));
  return saved;
}

export async function deleteProfile(address: string) {
  await kvDel(key(address));
  await deleteAvatar(address);
}

/** Saves a profile photo (base64 JPEG). Returns its version, which pages use to refresh their cached copy. */
export async function saveAvatar(address: string, base64: string): Promise<number> {
  const at = Date.now();
  await kvSet(avatarKey(address), base64);
  await kvSet(avatarAtKey(address), String(at));
  return at;
}

export async function getAvatar(address: string): Promise<string | null> {
  return kvGet(avatarKey(address));
}

export async function getAvatarAt(address: string): Promise<number | null> {
  const v = await kvGet(avatarAtKey(address));
  return v ? Number(v) : null;
}

export async function deleteAvatar(address: string) {
  await kvDel(avatarKey(address));
  await kvDel(avatarAtKey(address));
}

/** Public fields for the given addresses, only where the owner chose to show them. Never includes email. */
export async function publicProfiles(addresses: string[]): Promise<Map<string, PublicProfile>> {
  const out = new Map<string, PublicProfile>();
  if (!profilesEnabled() || !addresses.length) return out;
  const [raws, ats] = await Promise.all([
    kvMGet(addresses.map(key)).catch(() => [] as (string | null)[]),
    kvMGet(addresses.map(avatarAtKey)).catch(() => [] as (string | null)[]),
  ]);
  raws.forEach((raw, i) => {
    if (!raw) return;
    try {
      const p = JSON.parse(raw) as Profile;
      const avatarAt = ats[i] ? Number(ats[i]) : undefined;
      if (p.showPublic && (p.name || p.x || avatarAt)) out.set(addresses[i].toLowerCase(), { name: p.name, x: p.x, bio: p.bio, avatarAt });
    } catch {
      // skip a malformed record
    }
  });
  return out;
}
