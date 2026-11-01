// End-to-end test of invite-only sign-up: wallet sign-in, invite codes, email codes (sent for real through Resend to
// its delivered@resend.dev test inbox), usernames, the leaderboard, the faucet gate and deletion. Needs CRON_SECRET,
// RESEND_API_KEY, RESEND_FROM and the demo wallet keys in .env.local, and starts from an empty store:
//   node scripts/mock-upstash.mjs &
//   npm run build && UPSTASH_REDIS_REST_URL=http://127.0.0.1:8799 UPSTASH_REDIS_REST_TOKEN=test node --env-file=.env.local node_modules/next/dist/bin/next start -p 3100 &
//   node --env-file=.env.local scripts/test-signup.mjs
import { createHmac } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";

const SITE = "http://localhost:3100";
const MOCK = "http://127.0.0.1:8799";
const secret = process.env.CRON_SECRET.trim();
const [A, B, C] = ["DEMO_WALLET_1_PRIVATE_KEY", "DEMO_WALLET_2_PRIVATE_KEY", "DEMO_WALLET_3_PRIVATE_KEY"].map((k) => privateKeyToAccount(process.env[k].trim()));
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
const signIn = async (acct) => {
  const issuedAt = new Date().toISOString();
  const message = `Sign in to Nightshift\nAddress: ${acct.address.toLowerCase()}\nThis lets you edit your Nightshift profile. Free, no transaction.\nIssued: ${issuedAt}`;
  return req(acct.address, "POST", "/api/profile/session", { address: acct.address, signature: await acct.signMessage({ message }), issuedAt });
};
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
const admin = { Authorization: `Bearer ${secret}` };
const profile = (username, extra = {}) => ({ username, name: "", email: "ignored@x.com", x: "", telegram: "", website: "", bio: "", showPublic: true, ...extra });

// 1. connecting counts a user once
let r = await req(null, "POST", "/api/users/seen", { address: A.address });
check("connect counts a new user", r.j.counted === true);
r = await req(null, "POST", "/api/users/seen", { address: A.address });
check("connecting again doesn't count twice", r.j.counted === false);

// 2. nothing works before sign-in / invite
check("profile needs sign-in", (await req(A.address, "GET", "/api/profile")).j.signedIn === false);
check("wallet signature signs in", (await signIn(A)).status === 200);
r = await req(A.address, "GET", "/api/profile");
check("signed-in profile shows sign-up state", r.j.signedIn && r.j.member?.invite === false && r.j.emailEnabled === true, JSON.stringify(r.j.member));
check("saving a profile before the invite is refused", (await req(A.address, "PUT", "/api/profile", profile("alpha_1"))).status === 403);
check("email code before the invite is refused", (await req(A.address, "POST", "/api/profile/email", { email: "delivered@resend.dev" })).status === 403);

// 3. invite codes
check("admin endpoint refuses without the secret", (await req(null, "POST", "/api/admin/invites", { count: 1 })).status === 401);
r = await req(null, "POST", "/api/admin/invites", { count: 1, uses: 1, note: "e2e" }, admin);
const code = r.j.codes?.[0];
check("admin creates a one-use code", /^NS-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code ?? ""), code);
r = await req(A.address, "POST", "/api/profile/invite", { code: "NS-AAAA-AAAA" });
check("a made-up code is refused", r.status === 400, r.j.error);
r = await req(A.address, "POST", "/api/profile/invite", { code: code.toLowerCase().replace(/-/g, "") });
check("the real code works (any case, no dashes)", r.status === 200, r.j.error);
check("using it again from the same wallet is fine", (await req(A.address, "POST", "/api/profile/invite", { code })).status === 200);
await signIn(B);
r = await req(B.address, "POST", "/api/profile/invite", { code });
check("a used-up code is refused for another wallet", r.status === 400 && /used up/.test(r.j.error), r.j.error);

// 4. photo and profile still locked until the email is verified
check("saving before email verification is refused", (await req(A.address, "PUT", "/api/profile", profile("alpha_1"))).status === 403);
check("photo upload before email verification is refused", (await req(A.address, "PUT", "/api/profile/avatar", { image: "data:image/jpeg;base64,AAAA" })).status === 403);

// 5. email one-time code (sent for real through Resend, to its test inbox)
r = await req(A.address, "POST", "/api/profile/email", { email: "Delivered@resend.dev" });
check("Resend sends the code", r.status === 200, r.j.error);
r = await req(A.address, "POST", "/api/profile/email", { email: "delivered@resend.dev" });
check("asking again straight away waits", r.status === 429, r.j.error);
r = await req(A.address, "POST", "/api/profile/email/verify", { code: "999999" });
const wrongOk = r.status === 400 && /tries left/.test(r.j.error);
const otpA = await emailedCode(A.address, "delivered@resend.dev");
check("a wrong code is refused and counts a try", wrongOk || otpA === "999999", r.j.error);
r = await req(A.address, "POST", "/api/profile/email/verify", { code: otpA });
check("the emailed code verifies the email", r.status === 200 && r.j.email === "delivered@resend.dev", r.j.error);
check("a code can't be reused", (await req(A.address, "POST", "/api/profile/email/verify", { code: otpA })).status === 400);

// 6. username, registration
check("free username shows available", (await req(null, "GET", "/api/member?username=alpha_1")).j.available === true);
check("bad username is rejected by the check", (await req(null, "GET", "/api/member?username=No")).j.available === false);
check("bad username is refused on save", (await req(A.address, "PUT", "/api/profile", profile("A!"))).status === 400);
r = await req(A.address, "PUT", "/api/profile", profile("alpha_1", { name: "Alpha" }));
check("saving with a username registers the wallet", r.status === 200 && r.j.member?.registered === true, r.j.error);
check("the verified email is kept, the form's is ignored", r.j.profile?.email === "delivered@resend.dev", r.j.profile?.email);
check("public status says registered", (await req(null, "GET", `/api/member?address=${A.address}`)).j.registered === true);
check("the owner still sees the name as available to them", (await req(null, "GET", `/api/member?username=alpha_1&for=${A.address}`)).j.available === true);
check("others see it as taken", (await req(null, "GET", "/api/member?username=alpha_1")).j.available === false);

// 7. a second member: same email and same username are refused
const code2 = (await req(null, "POST", "/api/admin/invites", { count: 1, uses: 5, note: "e2e group" }, admin)).j.codes[0];
check("second wallet redeems a multi-use code", (await req(B.address, "POST", "/api/profile/invite", { code: code2 })).status === 200);
r = await req(B.address, "POST", "/api/profile/email", { email: "delivered@resend.dev" });
check("an email already linked to another wallet is refused", r.status === 409, r.j.error);
r = await req(B.address, "POST", "/api/profile/email", { email: "delivered+b@resend.dev" });
check("second wallet gets a code for its own email", r.status === 200, r.j.error);
r = await req(B.address, "POST", "/api/profile/email/verify", { code: await emailedCode(B.address, "delivered+b@resend.dev") });
check("second wallet verifies", r.status === 200, r.j.error);
r = await req(B.address, "PUT", "/api/profile", profile("alpha_1"));
check("a taken username is refused", r.status === 409, r.j.error);
check("second wallet registers with its own username", (await req(B.address, "PUT", "/api/profile", profile("beta_2", { showPublic: false }))).j.member?.registered === true);

// 8. leaderboard: registered members and connected-only wallets
await req(null, "POST", "/api/users/seen", { address: C.address });
const board = (await req(null, "GET", "/api/leaderboard")).j;
const row = (a) => board.rows?.find((x) => x.address === a.address.toLowerCase());
check("leaderboard lists member A with username", row(A)?.registered && row(A)?.username === "alpha_1", JSON.stringify(row(A))?.slice(0, 160));
check("hidden profile shows no username", row(B)?.registered && !row(B)?.username);
check("connected-only wallet is listed, not registered", row(C) && !row(C).registered && row(C).connectedAt > 0);
check("registration adds points", row(A)?.points >= board.scoring?.registered, `${row(A)?.points}`);
check("totals count registered members", board.totals?.registered >= 2, `${board.totals?.registered}`);

// 9. the faucet needs sign-up
const issuedAt = new Date().toISOString();
const sig = await C.signMessage({ message: `Nightshift demo-token faucet\nAddress: ${C.address.toLowerCase()}\nIssued: ${issuedAt}` });
r = await req(null, "POST", "/api/drip", { address: C.address, signature: sig, issuedAt });
check("faucet refuses a wallet that hasn't signed up", r.status === 403, r.j.error);

// 10. admin list, then deleting frees the username
const list = (await req(null, "GET", "/api/admin/invites", null, admin)).j.invites;
check("admin list shows who used each code", list?.some((i) => i.code === code && i.used === 1 && i.usedBy.includes(A.address.toLowerCase())));
check("deleting the profile works", (await req(A.address, "DELETE", "/api/profile")).status === 200);
check("the username is free again", (await req(null, "GET", "/api/member?username=alpha_1")).j.available === true);
check("the wallet is no longer registered", (await req(null, "GET", `/api/member?address=${A.address}`)).j.registered === false);
r = await req(A.address, "GET", "/api/profile");
check("the invite stays used, the email must be verified again", r.j.member?.invite === true && r.j.member?.email === null, JSON.stringify(r.j.member));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
