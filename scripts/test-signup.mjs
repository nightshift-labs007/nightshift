// End-to-end test of invite-only sign-up with no wallet signature: invite code + email → 6-digit code (sent for real
// through Resend to its delivered@resend.dev test inbox) → username. Also: signing back in by email, the guard against
// taking over a registered wallet, the leaderboard (no points), the faucet gate and deletion. Needs CRON_SECRET,
// RESEND_API_KEY and RESEND_FROM in .env.local, and starts from an empty store:
//   node scripts/mock-upstash.mjs &
//   npm run build && UPSTASH_REDIS_REST_URL=http://127.0.0.1:8799 UPSTASH_REDIS_REST_TOKEN=test node --env-file=.env.local node_modules/next/dist/bin/next start -p 3100 &
//   node --env-file=.env.local scripts/test-signup.mjs
import { createHmac } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const SITE = process.env.SITE ?? "http://localhost:3100";
const MOCK = "http://127.0.0.1:8799";
const secret = process.env.CRON_SECRET.trim();
const [A, B, C] = [1, 2, 3].map(() => privateKeyToAccount(generatePrivateKey())); // fresh wallets: nothing to sign
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`); };

const jar = new Map();
async function req(who, method, path, body, headers = {}) {
  const res = await fetch(SITE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(who && jar.get(who) ? { Cookie: jar.get(who) } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (who && set) jar.set(who, set.split(";")[0]);
  return { status: res.status, j: await res.json().catch(() => ({})) };
}
// the emailed code: recover it from the stored HMAC with our own secret (the test can't read the inbox)
async function emailedCode(addr, email) {
  const raw = (await fetch(MOCK, { method: "POST", body: JSON.stringify(["GET", `otp:${addr.toLowerCase()}`]) }).then((r) => r.json())).result;
  const { hash } = JSON.parse(raw);
  const key = createHmac("sha256", secret).update("nightshift-email-otp").digest();
  for (let i = 0; i < 1e6; i++) {
    const code = String(i).padStart(6, "0");
    if (createHmac("sha256", key).update(`${addr.toLowerCase()}:${email}:${code}`).digest("base64url") === hash) return code;
  }
  throw new Error("code not found");
}
const clearWait = (addr) => fetch(MOCK, { method: "POST", body: JSON.stringify(["DEL", `otp:wait:${addr.toLowerCase()}`]) }).catch(() => {});
const admin = { Authorization: `Bearer ${secret}` };
const profile = (username, extra = {}) => ({ username, name: "", email: "ignored@x.com", x: "", telegram: "", website: "", bio: "", showPublic: true, ...extra });
const seats = async (code) => (await req(null, "GET", "/api/admin/invites", null, admin)).j.invites?.find((i) => i.code === code)?.used;

// 1. connecting counts a user once
let r = await req(null, "POST", "/api/users/seen", { address: A.address });
check("connect counts a new user", r.j.counted === true);
r = await req(null, "POST", "/api/users/seen", { address: A.address });
check("connecting again doesn't count twice", r.j.counted === false);

// 2. invite codes
check("admin endpoint refuses without the secret", (await req(null, "POST", "/api/admin/invites", { count: 1 })).status === 401);
r = await req(null, "POST", "/api/admin/invites", { count: 1, uses: 1, note: "e2e" }, admin);
const code = r.j.codes?.[0];
check("admin creates a one-use code", /^NS-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code ?? ""), code);

// 3. sign-up step 1: invite code + email → a code, with no wallet signature
check("profile is signed out at first", (await req(A.address, "GET", "/api/profile")).j.signedIn === false);
r = await req(A.address, "POST", "/api/profile/email", { address: A.address, email: "delivered@resend.dev" });
check("an email code without an invite is refused", r.status === 403, r.j.error);
r = await req(A.address, "POST", "/api/profile/email", { address: A.address, email: "delivered@resend.dev", invite: "NS-AAAA-AAAA" });
check("a made-up invite code is refused before any email is sent", r.status === 400 && /doesn't exist/.test(r.j.error), r.j.error);
r = await req(A.address, "POST", "/api/profile/email", { address: A.address, email: "Delivered@resend.dev", invite: code.toLowerCase().replace(/-/g, "") });
check("invite (any case, no dashes) + email sends the code through Resend", r.status === 200, r.j.error);
check("the invite isn't used until the code is verified", (await seats(code)) === 0, `${await seats(code)}`);
r = await req(A.address, "POST", "/api/profile/email", { address: A.address, email: "delivered@resend.dev", invite: code });
check("asking again straight away waits", r.status === 429, r.j.error);
check("saving a profile before the code is refused", (await req(A.address, "PUT", "/api/profile", profile("alpha_1"))).status === 401);

// 4. step 2: the code verifies the email, uses the invite and signs the wallet in
r = await req(A.address, "POST", "/api/profile/email/verify", { address: A.address, code: "999999" });
const wrongOk = r.status === 400 && /tries left/.test(r.j.error);
const otpA = await emailedCode(A.address, "delivered@resend.dev");
check("a wrong code is refused and counts a try", wrongOk || otpA === "999999", r.j.error);
r = await req(A.address, "POST", "/api/profile/email/verify", { address: A.address, code: otpA });
check("the emailed code verifies and signs in (session cookie set)", r.status === 200 && r.j.email === "delivered@resend.dev" && !!jar.get(A.address), r.j.error);
check("the invite seat is used now", (await seats(code)) === 1);
check("a code can't be reused", (await req(A.address, "POST", "/api/profile/email/verify", { address: A.address, code: otpA })).status === 400);
r = await req(A.address, "GET", "/api/profile");
check("signed in: invite and email are done", r.j.signedIn && r.j.member?.invite && r.j.member?.email === "delivered@resend.dev", JSON.stringify(r.j.member));
check("photo upload works only after sign-up steps", (await req(B.address, "PUT", "/api/profile/avatar", { image: "data:image/jpeg;base64,AAAA" })).status === 401);

// 5. step 3: username → registered (and joined on the leaderboard)
check("free username shows available", (await req(null, "GET", "/api/member?username=alpha_1")).j.available === true);
check("bad username is refused on save", (await req(A.address, "PUT", "/api/profile", profile("A!"))).status === 400);
r = await req(A.address, "PUT", "/api/profile", profile("alpha_1", { name: "Alpha" }));
check("saving with a username registers the wallet", r.status === 200 && r.j.member?.registered === true, r.j.error);
check("the verified email is kept, the form's is ignored", r.j.profile?.email === "delivered@resend.dev", r.j.profile?.email);
check("public status says registered", (await req(null, "GET", `/api/member?address=${A.address}`)).j.registered === true);
check("others see the username as taken", (await req(null, "GET", "/api/member?username=alpha_1")).j.available === false);

// 6. signing back in by email, and the guard against taking over a registered wallet
jar.delete(A.address);
await clearWait(A.address);
r = await req("intruder", "POST", "/api/profile/email", { address: A.address, email: "delivered+evil@resend.dev" });
check("without a session, a registered wallet can't get a code at another email", r.status === 403, r.j.error);
r = await req(A.address, "POST", "/api/profile/email", { address: A.address, email: "delivered@resend.dev" });
check("the member gets a sign-in code at their own email (no invite needed)", r.status === 200, r.j.error);
r = await req(A.address, "POST", "/api/profile/email/verify", { address: A.address, code: await emailedCode(A.address, "delivered@resend.dev") });
check("the code signs the member back in", r.status === 200 && (await req(A.address, "GET", "/api/profile")).j.member?.registered === true, r.j.error);

// 7. a second member: a used-up invite, a taken email and a taken username are refused
await clearWait(B.address);
r = await req(B.address, "POST", "/api/profile/email", { address: B.address, email: "delivered+b@resend.dev", invite: code });
check("a used-up invite is refused for another wallet", r.status === 400 && /used up/.test(r.j.error), r.j.error);
const code2 = (await req(null, "POST", "/api/admin/invites", { count: 1, uses: 5, note: "e2e group" }, admin)).j.codes[0];
r = await req(B.address, "POST", "/api/profile/email", { address: B.address, email: "delivered@resend.dev", invite: code2 });
check("an email already linked to another wallet is refused", r.status === 409, r.j.error);
await clearWait(B.address);
r = await req(B.address, "POST", "/api/profile/email", { address: B.address, email: "delivered+b@resend.dev", invite: code2 });
check("second wallet gets a code for its own email", r.status === 200, r.j.error);
r = await req(B.address, "POST", "/api/profile/email/verify", { address: B.address, code: await emailedCode(B.address, "delivered+b@resend.dev") });
check("second wallet verifies", r.status === 200, r.j.error);
check("a taken username is refused", (await req(B.address, "PUT", "/api/profile", profile("alpha_1"))).status === 409);
check("second wallet registers with its own username", (await req(B.address, "PUT", "/api/profile", profile("beta_2", { showPublic: false }))).j.member?.registered === true);

// 8. leaderboard: members in sign-up order, connected-only wallets after, no points
await req(null, "POST", "/api/users/seen", { address: C.address });
const board = (await req(null, "GET", "/api/leaderboard")).j;
const row = (a) => board.rows?.find((x) => x.address === a.address.toLowerCase());
check("leaderboard lists member A with username", row(A)?.registered && row(A)?.username === "alpha_1", JSON.stringify(row(A))?.slice(0, 160));
check("hidden profile shows no username", row(B)?.registered && !row(B)?.username);
check("members are ranked in sign-up order", row(A)?.rank < row(B)?.rank, `${row(A)?.rank} < ${row(B)?.rank}`);
check("connected-only wallet comes after the members", row(C) && !row(C).registered && row(C).rank > row(B).rank);
check("no points anywhere", !("points" in (row(A) ?? {})) && !("scoring" in board));
check("totals count registered members", board.totals?.registered >= 2, `${board.totals?.registered}`);

// 9. the faucet needs sign-up
const issuedAt = new Date().toISOString();
const sig = await C.signMessage({ message: `Nightshift demo-token faucet\nAddress: ${C.address.toLowerCase()}\nIssued: ${issuedAt}` });
r = await req(null, "POST", "/api/drip", { address: C.address, signature: sig, issuedAt });
check("faucet refuses a wallet that hasn't signed up", r.status === 403, r.j.error);

// 10. deleting frees the username
check("deleting the profile works", (await req(A.address, "DELETE", "/api/profile")).status === 200);
check("the username is free again", (await req(null, "GET", "/api/member?username=alpha_1")).j.available === true);
check("the wallet is no longer registered", (await req(null, "GET", `/api/member?address=${A.address}`)).j.registered === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
