// Go-live smoke test, against any deployment (a Vercel preview, production, or a local server).
//
//   node scripts/smoke.mjs https://<preview-url>            # public checks + pick + abuse limits + safety
//   CRON_SECRET=… node scripts/smoke.mjs <url>              # + scheduler endpoints, metrics, error log
//   SMOKE_EMAIL=you@… node scripts/smoke.mjs <url>          # + real sign-in: asks you to paste the code from your inbox
//   Last, it loads the public pages in headless Chrome (scripts/smoke-browser.mjs): real content, no wall, no errors.
//
// On a deployment in TEST MODE (local dev, or a preview/staging with PLAY_TEST_MODE=1) it also runs the full game cycle
// on a past round with the test clock: pick → lock → settle from real prices → results email (dev outbox when Resend
// isn't set; otherwise check the inbox). On production it checks that every test-only door is closed.
//
// PRODUCTION IS READ-ONLY BY DEFAULT: no picks, no player cookie (so no analytics), no error-log entry, no sign-in codes,
// no rate-limit burst. The only thing it triggers is one scheduled job run (with CRON_SECRET), exactly what the scheduler
// does every 5 minutes. SMOKE_WRITE=1 adds the checks that write test data to production (a pick, the rate limits,
// an error-log entry); clean up afterwards.
import { createInterface } from "node:readline/promises";
import { browserChecks } from "./smoke-browser.mjs";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.CRON_SECRET ?? "";
const EMAIL = process.env.SMOKE_EMAIL ?? "";
const WRITE_OPT_IN = process.env.SMOKE_WRITE === "1";
let pass = 0, fail = 0, skip = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ok  ", m)) : (fail++, console.log("  FAIL", m)));
const skipped = (m) => (skip++, console.log("  skip", m));

async function call(path, { method = "GET", body, cookie, now, auth } = {}) {
  const headers = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  if (now) headers["x-play-now"] = now;
  if (auth) headers.authorization = `Bearer ${SECRET}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual", signal: AbortSignal.timeout(120_000) });
  const set = res.headers.get("set-cookie");
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, json: type.includes("json") ? await res.json().catch(() => null) : null, text: type.includes("html") ? await res.text() : "", cookie: set ? set.split(";")[0] : null };
}
const RUN = Date.now().toString(36);

try {
  console.log(`smoke test: ${BASE}`);

  console.log("\npublic pages and health");
  for (const p of ["/", "/app", "/privacy", "/terms"]) ok((await call(p)).status === 200, `${p} loads`);
  const priv = await call("/privacy");
  ok(/pending legal review/i.test(priv.text), "privacy page is marked as a draft for legal review");
  const health = (await call("/api/ops/health?soft=1")).json;
  ok(!!health && typeof health.ready === "boolean", "/api/ops/health answers");
  const TEST = health?.testMode === true;
  const WRITE = TEST || WRITE_OPT_IN; // test-mode deployments hold test data anyway
  console.log(TEST ? "  info test mode: full cycle, writes test data" : WRITE ? "  WARN SMOKE_WRITE=1 on production: this writes test picks, events and an error-log entry" : "  info production, read-only (SMOKE_WRITE=1 adds the write checks)");
  console.log(`  info ready=${health?.ready} testMode=${TEST} store=${health?.store} checks=${JSON.stringify(health?.checks)}`);
  for (const [k, v] of Object.entries(health?.checks ?? {})) if (!v && k !== "captcha") console.log(`  warn not ready: ${k}`);

  console.log("\nthe game without an account");
  const st = (await call("/api/play")).json;
  ok(st?.round?.date && st.assets?.length === 5, `current round ${st?.round?.date}, 5 assets`);
  let p = { cookie: null };
  if (WRITE) {
    p = await call("/api/play/pick", { method: "POST", body: { date: st.round.date, ticker: "SPY", side: "up" } });
    ok(p.status === 200 && !!p.cookie, "a pick with no wallet or account is saved and sets a cookie");
    ok((await call("/api/play", { cookie: p.cookie })).json?.myPicks?.SPY === "up", "the pick is there on reload");
  } else skipped("saving a pick (writes to production; SMOKE_WRITE=1)");
  ok((await call("/api/predict")).json?.enabled === false || process.env.SMOKE_EXPECT_REAL_STAKES === "1", "real stakes are off (/api/predict enabled:false)");
  ok((await call("/api/member?address=0x0000000000000000000000000000000000000001")).json?.registered === false, "an unknown wallet is not registered (gate fails closed)");

  if (!TEST) {
    console.log("\nproduction safety (test mode is off here)");
    ok((await call("/api/play/dev/outbox")).status === 404, "dev outbox is closed");
    ok((await call("/api/play/dev/ai-call", { method: "POST", body: { session: "2026-11-20", p: { SPY: 1 } } })).status === 404, "Beat-the-AI test route is closed");
    const past = await call("/api/play/pick", { method: "POST", body: { date: "2026-11-19", ticker: "SPY", side: "up" }, now: "2026-11-19T15:00:00Z" });
    ok(past.status === 409 || past.status === 429, "the test clock header is ignored (a past round can't be picked)");
    ok((await call("/api/ops/metrics")).status === 401, "metrics need the CRON_SECRET");
  } else {
    console.log("\nfull cycle on a past round (test mode): sign in, pick, lock, settle, results email");
    const email = `smoke-${RUN}@example.com`;
    const a = await call("/api/play/pick", { method: "POST", body: { date: "2026-11-19", ticker: "SPY", side: "down" }, now: "2026-11-19T15:00:00Z" });
    ok(a.status === 200, "pick for Thu 19 Nov (test clock)");
    const code = await call("/api/play/account/code", { method: "POST", body: { email } });
    const box = (await call("/api/play/dev/outbox")).json?.messages ?? [];
    const c = box.filter((m) => m.to === email).map((m) => m.subject.match(/^(\d{6})/)?.[1]).pop();
    if (code.status !== 200 || !c) skipped("sign-in: no code in the dev outbox (Resend is set here: use SMOKE_EMAIL to test real delivery)");
    else {
      const v = await call("/api/play/account/verify", { method: "POST", body: { email, code: c, nick: `smoke_${RUN}`.slice(0, 16) }, cookie: a.cookie });
      ok(v.status === 200 && v.json?.state?.account, "signed in with the emailed code");
      const ck = v.cookie ?? a.cookie;
      await call("/api/play/account/settings", { method: "POST", body: { remind: { open: false, lock: false, results: true } }, cookie: ck });
      ok((await call("/api/play/pick", { method: "POST", body: { date: "2026-11-19", ticker: "SPY", side: "up" }, now: "2026-11-19T21:00:00Z", cookie: ck })).status === 409, "at the 16:00 ET close the round is locked");
      let h = null;
      for (let i = 0; i < 4 && h?.status !== "settled"; i++) {
        const s = (await call("/api/play", { cookie: ck, now: "2026-11-20T16:00:00Z" })).json;
        h = s.history.find((x) => x.mode === "close" && x.date === "2026-11-19");
        if (h?.status !== "settled") await new Promise((r) => setTimeout(r, 20_000));
      }
      if (h?.status !== "settled") skipped(`settlement: still "${h?.status}" (price source unavailable or rate-limited)`);
      else {
        const spy = h.picks.find((x) => x.ticker === "SPY");
        ok(spy && spy.close > 0 && spy.open > 0, `settled from real prices: SPY ${spy.close} → ${spy.open} (${spy.outcome}), pick ${spy.side} = ${spy.result}`);
        const mails = ((await call("/api/play/dev/outbox")).json?.messages ?? []).filter((m) => m.to === email && /^Your results/.test(m.subject));
        ok(mails.length === 1 && /\/r\/results-close/.test(mails[0].text) && /Stop these emails/.test(mails[0].text), "results email sent once, with a tracked link and an unsubscribe link");
      }
    }
  }

  if (EMAIL) {
    console.log(`\nreal email sign-in to ${EMAIL}`);
    const r = await call("/api/play/account/code", { method: "POST", body: { email: EMAIL } });
    ok(r.status === 200, "code requested");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const code = (await rl.question("  paste the 6-digit code from the email: ")).trim();
    rl.close();
    const v = await call("/api/play/account/verify", { method: "POST", body: { email: EMAIL, code }, cookie: p.cookie });
    ok(v.status === 200 && v.json?.state?.account, `signed in as ${v.json?.state?.account?.nick ?? "?"}`);
  }

  if (SECRET) {
    console.log("\nscheduler, metrics and error log (CRON_SECRET)");
    ok((await call("/api/jobs/play")).status === 401, "/api/jobs/play refuses without the secret");
    const j = await call("/api/jobs/play", { auth: true });
    ok(j.status === 200 && j.json?.settle && j.json?.reminders, "/api/jobs/play runs settle, reminders and the evening call");
    const h2 = (await call("/api/ops/health?soft=1")).json;
    ok(!h2.jobs.settle.stale && !h2.jobs.reminders.stale && !h2.jobs.aiCall.stale, "after a scheduled run, the game jobs are not stale");
    const k = await call("/api/keeper", { auth: true });
    ok(k.status === 200, "/api/keeper runs");
    if (WRITE) {
      await call("/api/ops/error", { method: "POST", body: { msg: `smoke ${RUN} for me@example.com`, where: "/smoke?x=1" } });
      const errs = (await call("/api/ops/errors", { auth: true })).json?.errors ?? [];
      const mine = errs.find((e) => e.msg.includes(`smoke ${RUN}`));
      ok(!!mine && !mine.msg.includes("me@example.com") && !mine.where.includes("?"), "a browser error is logged, scrubbed of the email and the query string");
    } else ok(Array.isArray((await call("/api/ops/errors", { auth: true })).json?.errors), "the error log answers with the secret");
    const m = (await call("/api/ops/metrics?days=2", { auth: true })).json;
    const today = m?.daily?.at(-1)?.events ?? {};
    if (WRITE) ok((today.pick ?? 0) >= 1 && (today.visit ?? 0) >= 1, `today's events are counted (${JSON.stringify(today)})`);
    else ok(Array.isArray(m?.daily), `metrics answer (today: ${JSON.stringify(today)})`);
  } else skipped("scheduler, metrics and error log (set CRON_SECRET to run them)");
  console.log("\nabuse limits");
  if (!WRITE) skipped("abuse limits (sends codes and 130 picks; SMOKE_WRITE=1)");
  else {
    // Resend's test address accepts mail without delivering it; on a local server mail goes to the dev outbox
    const target = `delivered+smoke-${RUN}@resend.dev`;
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await call("/api/play/account/code", { method: "POST", body: { email: target } })).status);
    if (codes[0] === 503 || codes[0] === 502) skipped(`email isn't configured here (status ${codes[0]}), so code limits weren't exercised`);
    else ok(codes.slice(0, 3).every((c) => c === 200) && codes[3] === 429, `4th code to one address within 10 minutes is refused (${codes.join(",")})`);
    // last, because it blocks picks from this IP for a minute; 130 picks cross any fixed window and the per-player hourly cap
    const statuses = [];
    for (let i = 0; i < 130; i++) statuses.push((await call("/api/play/pick", { method: "POST", body: { date: st.round.date, ticker: "GLD", side: i % 2 ? "up" : "down" }, cookie: p.cookie })).status);
    const first429 = statuses.indexOf(429);
    ok(first429 > 0 && first429 <= 121, `rapid picks are rate-limited (first refusal at pick ${first429 + 1})`);
  }
} catch (e) {
  fail++;
  console.log("  FAIL request error:", e?.cause?.code ?? e?.message ?? e);
}
try {
  await browserChecks(BASE, { ok, skipped });
} catch (e) {
  fail++;
  console.log("  FAIL browser checks:", e?.message ?? e);
}
console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(fail ? 1 : 0);
