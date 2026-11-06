/** Profile fields, limits and validation, shared by the profile API and the profile page. */
export type Profile = {
  username: string; // unique handle, lowercase; required to finish sign-up
  name: string;
  email: string; // private, set only by verifying a one-time code; never returned by public endpoints
  x: string; // X handle, without @
  telegram: string; // Telegram username, without @
  website: string;
  bio: string;
  showPublic: boolean; // show name and X on the leaderboard
  updatedAt?: string;
};
export type PublicProfile = Pick<Profile, "name" | "x" | "bio"> & { username?: string; avatarAt?: number };

/** Where a wallet is in sign-up: connect → invite code → verified email → username and profile. */
export type Membership = { invite: boolean; email: string | null; registered: boolean; registeredAt: number | null; hasPassword?: boolean };

/** Password rules for signing in (the email code is only for sign-up and resets). */
export const PASSWORD = { min: 8, max: 128 };

export const EMPTY_PROFILE: Profile = { username: "", name: "", email: "", x: "", telegram: "", website: "", bio: "", showPublic: true };
export const USERNAME = /^[a-z0-9_]{3,20}$/;
/** Invite codes are shown as NS-XXXX-XXXX; people may type them in any case, with or without dashes. */
export const normalizeInvite = (s: string) => {
  const c = String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === 10 && c.startsWith("NS") ? c.slice(2) : c;
};
export const LIMITS = { name: 40, email: 254, bio: 160, website: 120 };
/** Profile photos: the browser crops and resizes to a square JPEG before upload, so this cap is generous. */
export const AVATAR = { size: 256, maxBytes: 80_000 };

/** The message a wallet signs to sign in to its profile (free, no transaction). */
export const signInMessage = (address: string, issuedAt: string) =>
  `Sign in to Nightshift\nAddress: ${address.toLowerCase()}\nThis lets you edit your Nightshift profile. Free, no transaction.\nIssued: ${issuedAt}`;

const strip = (s: unknown) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();

/** Cleans and checks a submitted profile. Returns the clean profile, or the first problem found. */
export function validateProfile(input: Partial<Profile>): { ok: true; profile: Profile } | { ok: false; error: string } {
  const p: Profile = {
    username: strip(input.username).replace(/^@/, "").toLowerCase(),
    name: strip(input.name),
    email: strip(input.email).toLowerCase(),
    x: strip(input.x).replace(/^@/, "").replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").replace(/[/?#].*$/, ""),
    telegram: strip(input.telegram).replace(/^@/, "").replace(/^https?:\/\/t\.me\//i, "").replace(/[/?#].*$/, ""),
    website: strip(input.website),
    bio: strip(input.bio),
    showPublic: input.showPublic !== false,
  };
  if (!USERNAME.test(p.username)) return { ok: false, error: "Pick a username: 3 to 20 lowercase letters, numbers or underscores." };
  if (p.name.length > LIMITS.name) return { ok: false, error: `Name can be at most ${LIMITS.name} characters.` };
  if (p.email && (p.email.length > LIMITS.email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(p.email))) return { ok: false, error: "That email address doesn't look right." };
  if (p.x && !/^[A-Za-z0-9_]{1,15}$/.test(p.x)) return { ok: false, error: "X handles are 1 to 15 letters, numbers or underscores." };
  if (p.telegram && !/^[A-Za-z0-9_]{5,32}$/.test(p.telegram)) return { ok: false, error: "Telegram usernames are 5 to 32 letters, numbers or underscores." };
  if (p.website) {
    if (!/^https?:\/\//i.test(p.website)) p.website = `https://${p.website}`;
    try {
      const u = new URL(p.website);
      if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".") || p.website.length > LIMITS.website) throw new Error();
    } catch {
      return { ok: false, error: "That website address doesn't look right." };
    }
  }
  if (p.bio.length > LIMITS.bio) return { ok: false, error: `Bio can be at most ${LIMITS.bio} characters.` };
  return { ok: true, profile: p };
}
