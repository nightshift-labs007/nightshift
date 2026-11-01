// In-memory stand-in for the Upstash Redis REST API (only the commands Nightshift uses), for scripts/test-signup.mjs. Port 8799.
import http from "node:http";
const db = new Map(); // key -> { v, exp }
const live = (k) => { const e = db.get(k); if (e && e.exp && e.exp < Date.now()) { db.delete(k); return undefined; } return e?.v; };
const put = (k, v, exp) => db.set(k, { v, exp });
const hash = (k) => { let h = live(k); if (!(h instanceof Map)) { h = new Map(); put(k, h); } return h; };
function run([c, ...a]) {
  c = String(c).toUpperCase();
  switch (c) {
    case "GET": { const v = live(a[0]); return typeof v === "string" ? v : null; }
    case "SET": {
      const [k, v, ...o] = a; const opts = o.map((x) => String(x).toUpperCase());
      if (opts.includes("NX") && live(k) !== undefined) return null;
      const ex = opts.indexOf("EX"); put(k, String(v), ex >= 0 ? Date.now() + Number(o[ex + 1]) * 1000 : 0); return "OK";
    }
    case "DEL": return a.reduce((n, k) => n + (db.delete(k) ? 1 : 0), 0);
    case "MGET": return a.map((k) => { const v = live(k); return typeof v === "string" ? v : null; });
    case "INCR": { const n = Number(live(a[0]) ?? 0) + 1; const e = db.get(a[0]); put(a[0], String(n), e?.exp ?? 0); return n; }
    case "EXPIRE": { const e = db.get(a[0]); if (!e) return 0; e.exp = Date.now() + Number(a[1]) * 1000; return 1; }
    case "HSET": { const h = hash(a[0]); const isNew = !h.has(a[1]); h.set(a[1], String(a[2])); return isNew ? 1 : 0; }
    case "HSETNX": { const h = hash(a[0]); if (h.has(a[1])) return 0; h.set(a[1], String(a[2])); return 1; }
    case "HGET": { const h = live(a[0]); return h instanceof Map ? h.get(a[1]) ?? null : null; }
    case "HDEL": { const h = live(a[0]); return h instanceof Map && h.delete(a[1]) ? 1 : 0; }
    case "HLEN": { const h = live(a[0]); return h instanceof Map ? h.size : 0; }
    case "HINCRBY": { const h = hash(a[0]); const n = Number(h.get(a[1]) ?? 0) + Number(a[2]); h.set(a[1], String(n)); return n; }
    case "HGETALL": { const h = live(a[0]); return h instanceof Map ? [...h].flat() : []; }
    case "SADD": { let s = live(a[0]); if (!(s instanceof Set)) { s = new Set(); put(a[0], s); } const n = s.size; a.slice(1).forEach((m) => s.add(String(m))); return s.size - n; }
    case "SMEMBERS": { const s = live(a[0]); return s instanceof Set ? [...s] : []; }
    default: throw new Error(`mock: unsupported ${c}`);
  }
}
http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const send = (x, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(x)); };
    try {
      if (req.method === "POST" && req.url === "/pipeline") return send(JSON.parse(body).map((cmd) => ({ result: run(cmd) })));
      if (req.method === "POST") return send({ result: run(JSON.parse(body)) });
      return send({ result: run(req.url.split("/").filter(Boolean).map(decodeURIComponent)) }); // path style: /set/key/1/NX/EX/60
    } catch (e) { send({ error: String(e.message) }, 400); }
  });
}).listen(8799, () => console.log("mock upstash on 8799"));
