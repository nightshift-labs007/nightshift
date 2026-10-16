// End-to-end test of profiles (sign-in, save, validation, privacy, delete) against a running site whose profile
// store is connected, e.g. a dev server with UPSTASH_REDIS_REST_URL/TOKEN set:
//   BASE=http://localhost:3000 node scripts/test-profile.mjs
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE = process.env.BASE || "http://localhost:3000";
const acct = privateKeyToAccount(generatePrivateKey()); // throwaway test wallet
const other = privateKeyToAccount(generatePrivateKey());
const msg = (a, t) => `Sign in to Nightshift\nAddress: ${a.toLowerCase()}\nThis lets you edit your Nightshift profile. Free, no transaction.\nIssued: ${t}`;
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`); };
const j = async (path, opts = {}) => { const r = await fetch(BASE + path, opts); return { status: r.status, body: await r.json().catch(() => null), cookie: r.headers.get("set-cookie") }; };

// 1. not signed in
let r = await j("/api/profile");
check("anonymous GET says signed out", r.body?.enabled === true && r.body?.signedIn === false);
r = await j("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" });
check("anonymous PUT is refused", r.status === 401);

// 2. sign-in with someone else's signature fails
let t = new Date().toISOString();
r = await j("/api/profile/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: acct.address, issuedAt: t, signature: await other.signMessage({ message: msg(acct.address, t) }) }) });
check("sign-in with a different wallet's signature is refused", r.status === 401);

// 3. real sign-in
t = new Date().toISOString();
r = await j("/api/profile/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: acct.address, issuedAt: t, signature: await acct.signMessage({ message: msg(acct.address, t) }) }) });
const cookie = (r.cookie ?? "").split(";")[0];
check("sign-in sets an HttpOnly session cookie", r.status === 200 && cookie.startsWith("ns_session=") && /HttpOnly/i.test(r.cookie ?? ""));
const H = { "content-type": "application/json", cookie };

// 4. forged cookie
r = await j("/api/profile", { headers: { cookie: cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A")) } });
check("tampered cookie is not accepted", r.body?.signedIn === false);
r = await j("/api/profile", { headers: { cookie: `ns_session=${other.address.toLowerCase()}.9999999999.${cookie.split(".").pop()}` } });
check("cookie moved to another address is not accepted", r.body?.signedIn === false);

// 5. empty profile, then save
r = await j("/api/profile", { headers: H });
check("signed-in GET returns an empty profile", r.body?.signedIn === true && r.body?.address === acct.address.toLowerCase() && r.body?.profile?.name === "");
const good = { name: "Night Owl", email: "Owl@Example.com", x: "@night_owl", telegram: "https://t.me/nightowl", website: "nightshift.buzz", bio: "Testing", showPublic: true };
r = await j("/api/profile", { method: "PUT", headers: H, body: JSON.stringify(good) });
check("save works and cleans input", r.status === 200 && r.body?.profile?.email === "owl@example.com" && r.body?.profile?.x === "night_owl" && r.body?.profile?.telegram === "nightowl" && r.body?.profile?.website === "https://nightshift.buzz", JSON.stringify(r.body?.profile));
r = await j("/api/profile", { headers: H });
check("saved profile reads back, email included for the owner", r.body?.profile?.name === "Night Owl" && r.body?.profile?.email === "owl@example.com" && !!r.body?.profile?.updatedAt);

// 6. validation
for (const [label, bad] of [["bad email", { ...good, email: "nope" }], ["bad X handle", { ...good, x: "has space" }], ["long name", { ...good, name: "x".repeat(41) }], ["javascript: website", { ...good, website: "javascript:alert(1)" }], ["long bio", { ...good, bio: "y".repeat(161) }]]) {
  r = await j("/api/profile", { method: "PUT", headers: H, body: JSON.stringify(bad) });
  check(`rejects ${label}`, r.status === 400, r.body?.error);
}

// 7. public view never leaks email
r = await j("/api/leaderboard");
const leak = JSON.stringify(r.body ?? {}).includes("owl@example.com");
check("leaderboard response never contains the email", r.status === 200 && !leak);

// 8. delete and sign out
r = await j("/api/profile", { method: "DELETE", headers: H });
check("delete works", r.status === 200);
r = await j("/api/profile", { headers: H });
check("after delete the profile is empty", r.body?.profile?.name === "" && r.body?.profile?.email === "");
r = await j("/api/profile/session", { method: "DELETE" });
check("sign-out clears the cookie", r.status === 200 && /Max-Age=0/i.test(r.cookie ?? ""));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
