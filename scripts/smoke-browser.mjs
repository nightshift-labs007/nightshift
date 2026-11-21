// Headless-browser half of the smoke test: loads the public pages in a real (headless) Chrome and checks that each one
// renders its real content, not a sign-in wall, an error screen or an endless skeleton, with no uncaught errors.
// No dependencies: drives the installed Chrome over its DevTools protocol (Node 22's built-in WebSocket).
// Read-only: a fresh browser profile has no player cookie, so visits aren't counted in analytics and nothing is written.
//
//   node scripts/smoke-browser.mjs <url>          # on its own
//   (also run by scripts/smoke.mjs; CHROME=/path/to/chrome to override, SMOKE_BROWSER=0 to skip)
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// what each public page must show once it has loaded (checked on the visible text)
export const PAGES = [
  { path: "/", must: [/Nightshift/i], what: "home" },
  { path: "/app", must: [/Prices/, /Big stocks/i], selector: ".fp-row:not(.fp-row-head)", what: "app: fair prices" },
  { path: "/app#predict", must: [/Points mode uses no real money/i], mustNot: [/REAL STAKES/], what: "app: points game" },
  { path: "/oracle", must: [/Fair value while the market is closed/i, /Shift report/i], what: "oracle" },
  { path: "/stock/AAPL", must: [/Apple/], what: "stock page" },
  { path: "/etf/SPY", must: [/SPY/], what: "ETF page" },
];
const WALL = [/MEMBERS ONLY/i, /Sign in to see/i, /Application error/i, /This page couldn.t load/i, /Internal Server Error/i, /404: This page could not be found/i];

async function openChrome() {
  const port = 9400 + Math.floor(Math.random() * 500);
  const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "ns-smoke-"));
  const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1366,900", "--no-first-run", "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 75 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {}
  }
  if (!target) throw new Error("Chrome didn't start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) return pending.get(d.id)(d.result ?? d.error), pending.delete(d.id);
    for (const l of listeners) l(d);
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const close = () => { try { ws.close(); } catch {} proc.kill(); setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500); };
  return { send, on: (f) => listeners.push(f), close };
}

/** Runs the page checks; `ok(cond, msg)` and `skipped(msg)` are the smoke test's reporters. */
export async function browserChecks(base, { ok, skipped, timeoutMs = 45_000 }) {
  if (process.env.SMOKE_BROWSER === "0") return skipped("browser checks (SMOKE_BROWSER=0)");
  if (!CHROME) return skipped("browser checks: Chrome not found (set CHROME=/path/to/chrome)");
  const b = await openChrome();
  try {
    let errors = [];
    b.on((d) => {
      const p = d.params;
      if (d.method === "Runtime.exceptionThrown") errors.push("exception: " + (p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).split("\n")[0].slice(0, 200));
      if (d.method === "Runtime.consoleAPICalled" && p.type === "error") errors.push("console: " + p.args.map((a) => a.value ?? a.description ?? "").join(" ").split("\n")[0].slice(0, 200));
    });
    await Promise.all([b.send("Runtime.enable"), b.send("Page.enable")]);
    const text = async (sel) => (await b.send("Runtime.evaluate", { expression: `(()=>{const e=document.querySelector(${JSON.stringify(sel)});return e?e.innerText:""})()`, returnByValue: true }))?.result?.value ?? "";
    const count = async (sel) => (await b.send("Runtime.evaluate", { expression: `document.querySelectorAll(${JSON.stringify(sel)}).length`, returnByValue: true }))?.result?.value ?? 0;
    for (const pg of PAGES) {
      errors = [];
      await b.send("Page.navigate", { url: "about:blank" });
      await b.send("Page.navigate", { url: base + pg.path });
      const t0 = Date.now();
      let body = "", wall, good = false;
      // wait until the page shows its content (or a wall/error), up to the timeout
      while (Date.now() - t0 < timeoutMs) {
        await sleep(1000);
        body = await text("body");
        wall = WALL.find((re) => re.test(body));
        if (wall) break;
        good = pg.must.every((re) => re.test(body)) && (!pg.selector || (await count(pg.selector)) > 0) && !/Checking your session/i.test(body);
        if (good) break;
      }
      await sleep(1500); // let late client errors surface
      const bad = (pg.mustNot ?? []).find((re) => re.test(body));
      const detail = wall ? `shows "${wall.source}"` : !good ? `missing ${pg.must.filter((re) => !re.test(body)).map((r) => r.source).join(", ") || pg.selector}` : bad ? `shows "${bad.source}"` : errors.length ? errors.slice(0, 2).join(" | ") : `${((Date.now() - t0) / 1000).toFixed(0)}s`;
      ok(!wall && good && !bad && !errors.length, `browser ${pg.path} renders the ${pg.what} (${detail})`);
    }
  } finally {
    b.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let pass = 0, fail = 0;
  const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
  await browserChecks(base, { ok: (c, m) => (c ? (pass++, console.log("  ok  ", m)) : (fail++, console.log("  FAIL", m))), skipped: (m) => console.log("  skip", m) });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
