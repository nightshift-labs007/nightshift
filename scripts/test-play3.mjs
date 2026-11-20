// End-to-end test of Phase 3 against a running LOCAL dev server (uses the test clock and the dev outbox, which only
// exist outside production): sign-in with an email code, merging browsers, nicknames, leaderboard, Beat the AI,
// share cards, reminders and unsubscribe.
//   npm run dev            (in another terminal)
//   node scripts/test-play3.mjs [http://localhost:3000]
// Settlement uses real prices for Thu 19 / Fri 20 Nov 2026 through the price provider (cached once confirmed).
const BASE = process.argv[2] ?? "http://localhost:3000";
let pass = 0, fail = 0;
const ok = (cond, msg) => (cond ? (pass++, console.log("  ok  ", msg)) : (fail++, console.log("  FAIL", msg)));
const RUN = Date.now().toString(36);

async function call(path, { method = "GET", body, cookie, now } = {}) {
  const headers = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  if (now) headers["x-play-now"] = now;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual", signal: AbortSignal.timeout(120_000) });
  const set = res.headers.get("set-cookie");
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, type, json: type.includes("json") ? await res.json().catch(() => null) : null, text: type.includes("html") ? await res.text() : null, cookie: set ? set.split(";")[0] : null };
}
const pick = (date, ticker, side, opts, mode = "close") => call("/api/play/pick", { method: "POST", body: { mode, date, ticker, side }, ...opts });
const outbox = async () => (await call("/api/play/dev/outbox")).json.messages;
const lastCode = async (email) => (await outbox()).filter((m) => m.to === email).map((m) => m.subject.match(/^(\d{6}) is your/)?.[1]).filter(Boolean).pop();

async function signIn(email, cookie, nick) {
  const r1 = await call("/api/play/account/code", { method: "POST", body: { email } });
  const code = await lastCode(email);
  const r2 = await call("/api/play/account/verify", { method: "POST", body: { email, code, nick }, cookie });
  return { r1, r2, cookie: r2.cookie ?? cookie };
}

try {
  console.log("sign-in with an email code");
  const email = `p3-${RUN}@example.com`;
  const nick = `t_${RUN}`.slice(0, 16);
  const thu = "2026-11-19T15:00:00.000Z";
  const a = await pick("2026-11-19", "SPY", "up", { now: thu });
  let ca = a.cookie;
  await pick("2026-11-19", "GLD", "down", { now: thu, cookie: ca });
  {
    const bad = await call("/api/play/account/code", { method: "POST", body: { email: "not-an-email" } });
    ok(bad.status === 400, "an invalid email is refused");
    const r1 = await call("/api/play/account/code", { method: "POST", body: { email } });
    ok(r1.status === 200, "code requested (dev outbox on a local server)");
    const wrong = await call("/api/play/account/verify", { method: "POST", body: { email, code: "000000", nick }, cookie: ca });
    ok(wrong.status === 400, "a wrong code is refused");
    const code = await lastCode(email);
    ok(/^\d{6}$/.test(code ?? ""), "the code arrived in the outbox");
    const r2 = await call("/api/play/account/verify", { method: "POST", body: { email, code, nick }, cookie: ca });
    ok(r2.status === 200 && r2.json.created && r2.json.state.account.nick === nick, `account created as "${nick}"`);
    ok(r2.json.state.myPicks !== undefined && r2.json.state.history !== undefined, "state returned with the account");
    ca = r2.cookie ?? ca;
    const again = await call("/api/play/account/verify", { method: "POST", body: { email, code, nick }, cookie: ca });
    ok(again.status === 400, "a code works only once");
    const taken = await signIn(`other-${RUN}@example.com`, null, nick);
    ok(taken.r2.status === 409, "a taken nickname is refused for a new account");
  }

  console.log("a second browser signs in and is merged");
  {
    const b = await pick("2026-11-19", "NVDA", "down", { now: thu });
    await pick("2026-11-19", "SPY", "down", { now: thu, cookie: b.cookie }); // conflicts with the account's SPY up
    const countsBefore = (await call("/api/play", { cookie: b.cookie, now: thu })).json.crowd;
    const s = await signIn(email, b.cookie);
    ok(s.r2.status === 200 && s.r2.json.created === false, "same email in another browser signs in to the same account");
    const st = (await call("/api/play", { cookie: s.cookie, now: thu })).json;
    ok(st.myPicks.NVDA === "down", "the second browser's new pick (NVDA) was added");
    ok(st.myPicks.SPY === "up", "where both picked SPY, the account's pick stayed");
    ok(st.myPicks.GLD === "down", "the account's other picks are still there");
    ok(st.crowd.SPY.up + st.crowd.SPY.down === countsBefore.SPY.up + countsBefore.SPY.down - 1, "the dropped duplicate pick no longer counts in the crowd split");
  }

  console.log("Beat the AI (call set through the local-only test route)");
  {
    const set = await call("/api/play/dev/ai-call", { method: "POST", body: { session: "2026-11-20", at: Date.parse("2026-11-20T01:00:00Z"), p: { SPY: 714, GLD: 330, NVDA: 140 } } });
    ok(set.status === 200, "call set for Fri 20 Nov");
    const early = await pick("2026-11-20", "SPY", "down", { now: "2026-11-20T00:30:00.000Z", cookie: ca }, "ai");
    ok(early.status === 409, "before the 20:00 ET call: refused");
    const p1 = await pick("2026-11-20", "SPY", "down", { now: "2026-11-20T03:00:00.000Z", cookie: ca }, "ai");
    ok(p1.status === 200 && p1.json.ai.myPicks.SPY === "down", "after the call: SPY below $714 accepted");
    await pick("2026-11-20", "GLD", "up", { now: "2026-11-20T03:00:00.000Z", cookie: ca }, "ai");
    const noCall = await pick("2026-11-20", "TSLA", "up", { now: "2026-11-20T03:00:00.000Z", cookie: ca }, "ai");
    ok(noCall.status === 409, "an asset without a call can't be picked");
    const late = await pick("2026-11-20", "NVDA", "up", { now: "2026-11-20T09:00:00.000Z", cookie: ca }, "ai");
    ok(late.status === 409, "at 04:00 ET: locked");
  }

  console.log("reminders: results email after settlement, sent once, unsubscribe");
  {
    const r = await call("/api/play/account/settings", { method: "POST", body: { remind: { open: false, lock: true, results: true } }, cookie: ca });
    ok(r.status === 200 && r.json.account.remind.results === true, "reminders switched on");
    const before = (await outbox()).filter((m) => m.to === email).length;
    let st = null;
    for (let i = 0; i < 6; i++) {
      st = (await call("/api/play", { cookie: ca, now: "2026-11-20T16:00:00.000Z" })).json; // Fri 11:00 ET
      const done = st.history.filter((h) => (h.date === "2026-11-19" && h.mode === "close") || (h.date === "2026-11-20" && h.mode === "ai")).every((h) => h.status === "settled");
      if (done) break;
      await new Promise((res) => setTimeout(res, 20_000));
    }
    const close = st.history.find((h) => h.mode === "close" && h.date === "2026-11-19");
    const ai = st.history.find((h) => h.mode === "ai" && h.date === "2026-11-20");
    if (close?.status !== "settled" || ai?.status !== "settled") {
      console.log(`  SKIP settlement-dependent checks: close=${close?.status} ai=${ai?.status} (price source unavailable or rate-limited)`);
    } else {
      const spyAi = ai.picks.find((p) => p.ticker === "SPY");
      ok(spyAi.close === 714 && spyAi.outcome === (spyAi.open < 714 ? "down" : spyAi.open > 714 ? "up" : "flat"), `Beat the AI SPY: call $714 → open $${spyAi.open} is "${spyAi.outcome}"`);
      ok(st.points === (st.stats?.points ?? 0) + (st.aiStats?.points ?? 0), `total points ${st.points} = up/down + Beat the AI`);
      const mails = (await outbox()).filter((m) => m.to === email).slice(before);
      ok(mails.some((m) => /^Your results/.test(m.subject)), "a results email was sent");
      const n = mails.length;
      await call("/api/play", { cookie: ca, now: "2026-11-20T16:05:00.000Z" });
      ok((await outbox()).filter((m) => m.to === email).length - before === n, "running again doesn't send it twice");
      const unsub = mails.find((m) => /Stop these emails: /.test(m.text))?.text.match(/Stop these emails: (\S+)/)?.[1];
      ok(!!unsub && !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/.test(unsub), "the unsubscribe link exists and doesn't contain the player id");
      const u = await call(unsub.replace(/^https?:\/\/[^/]+/, ""));
      ok(u.status === 200 && /won't get any more/.test(u.text ?? ""), "unsubscribe link works");
      const after = (await call("/api/play", { cookie: ca, now: "2026-11-20T16:10:00.000Z" })).json.account.remind;
      ok(!after.results && !after.lock && !after.open, "all reminders are off after unsubscribing");

      console.log("leaderboard and share card");
      const lb = (await call("/api/play/leaderboard", { now: "2026-11-20T16:10:00.000Z" })).json;
      const me = lb.all.find((r) => r.nick === nick);
      ok(!!me && me.points === st.points, `on the all-time board with ${st.points} points`);
      ok(!JSON.stringify(lb).includes("@"), "the leaderboard shows no emails");
      const sh = await call("/api/play/share", { method: "POST", body: { mode: "close", date: "2026-11-19" }, cookie: ca, now: "2026-11-20T16:10:00.000Z" });
      ok(sh.status === 200 && /\/s\//.test(sh.json.url) && /x\.com\/intent/.test(sh.json.x) && /t\.me\/share/.test(sh.json.telegram), "share link with X and Telegram links");
      const path = sh.json.url.replace(/^https?:\/\/[^/]+/, "");
      const page = await call(path);
      ok(page.status === 200 && (page.text ?? "").includes(nick), "the share page shows the player's calls");
      const img = await fetch(BASE + path + "/opengraph-image");
      ok(img.status === 200 && (img.headers.get("content-type") ?? "").startsWith("image/png"), "the card image renders (PNG)");
      const tampered = path.replace(/\.([A-Za-z0-9_-]+)$/, ".AAAA$1");
      ok(((await call(tampered)).text ?? "").includes("isn't valid"), "an edited share link is rejected");
    }
  }

  console.log("lock reminder: an hour before the close, only if picks are missing");
  {
    const e2 = `lock-${RUN}@example.com`;
    const p = await pick("2026-11-24", "SPY", "up", { now: "2026-11-24T15:00:00.000Z" });
    const s = await signIn(e2, p.cookie);
    await call("/api/play/account/settings", { method: "POST", body: { remind: { open: false, lock: true, results: false } }, cookie: s.cookie });
    await call("/api/play", { cookie: s.cookie, now: "2026-11-24T20:20:00.000Z" }); // Tue 15:20 ET, lock at 16:00
    const m = (await outbox()).filter((x) => x.to === e2 && /lock/.test(x.subject));
    ok(m.length === 1 && /Still to pick: NVDA, AAPL, TSLA, GLD/.test(m[0].text), "lock reminder lists the assets still to pick");
  }

  console.log("deleting an account");
  {
    const e3 = `del-${RUN}@example.com`;
    const p = await pick("2026-11-24", "AAPL", "up", { now: "2026-11-24T15:00:00.000Z" });
    const s = await signIn(e3, p.cookie, `del_${RUN}`.slice(0, 16));
    ok((await call("/api/play/account/delete", { method: "POST", body: {}, cookie: s.cookie })).status === 400, "deletion needs an explicit confirmation");
    const d = await call("/api/play/account/delete", { method: "POST", body: { confirm: "delete" }, cookie: s.cookie });
    ok(d.status === 200 && /ns_play=;/.test(d.cookie + ";"), "account deleted and this browser signed out");
    const lb = (await call("/api/play/leaderboard", { now: "2026-11-24T15:00:00.000Z" })).json;
    ok(![...lb.all, ...lb.week].some((r) => r.nick === `del_${RUN}`.slice(0, 16)), "gone from the leaderboard");
    const again = await signIn(e3, null, `del2_${RUN}`.slice(0, 16));
    ok(again.r2.status === 200 && again.r2.json.created === true && Object.keys(again.r2.json.state.myPicks).length === 0, "the same email later starts a brand-new, empty account");
  }

  console.log("signing out");
  {
    const r = await call("/api/play/account/signout", { method: "POST" });
    ok(r.status === 200 && /ns_play=;/.test(r.cookie + ";") , "sign-out clears the cookie");
  }
} catch (e) {
  fail++;
  console.log("  FAIL request error:", e?.cause?.code ?? e?.message ?? e);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
