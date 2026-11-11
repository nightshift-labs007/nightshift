// One-time copy of the private store from Upstash Redis to Postgres (the tables lib/kv.ts uses).
// Safe to re-run: every row is an upsert. Rate-limit counters (rl:*) are skipped; they expire anyway.
//
//   KV_REST_API_URL=… KV_REST_API_TOKEN=… DATABASE_URL=postgres://… node scripts/migrate-upstash-to-postgres.mjs
//   (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN work too. Use Railway's public Postgres URL when running locally.)
import postgres from "postgres";

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const dbUrl = process.env.DATABASE_URL;
if (!url || !token || !dbUrl) {
  console.error("Set KV_REST_API_URL, KV_REST_API_TOKEN and DATABASE_URL.");
  process.exit(1);
}

async function cmd(args) {
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(args) });
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(`${args[0]}: ${j.error ?? res.status}`);
  return j.result;
}

const sql = postgres(dbUrl, { max: 2, onnotice: () => {} });
await sql`create table if not exists kv_string (key text primary key, value text not null, expires_at timestamptz)`;
await sql`create index if not exists kv_string_expires on kv_string (expires_at) where expires_at is not null`;
await sql`create table if not exists kv_hash (key text not null, field text not null, value text not null, primary key (key, field))`;
await sql`create table if not exists kv_set (key text not null, member text not null, primary key (key, member))`;

const counts = { string: 0, hash: 0, set: 0, skipped: 0 };
let cursor = "0";
do {
  const [next, keys] = await cmd(["SCAN", cursor, "COUNT", 500]);
  cursor = String(next);
  for (const key of keys) {
    if (key.startsWith("rl:")) { counts.skipped++; continue; }
    const type = await cmd(["TYPE", key]);
    if (type === "string") {
      const [value, pttl] = await Promise.all([cmd(["GET", key]), cmd(["PTTL", key])]);
      if (value === null || pttl === -2) continue; // expired meanwhile
      const expires = pttl > 0 ? new Date(Date.now() + pttl) : null;
      await sql`insert into kv_string (key, value, expires_at) values (${key}, ${value}, ${expires})
                on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at`;
      counts.string++;
    } else if (type === "hash") {
      const flat = await cmd(["HGETALL", key]);
      const rows = [];
      for (let i = 0; i + 1 < flat.length; i += 2) rows.push({ key, field: flat[i], value: flat[i + 1] });
      for (let i = 0; i < rows.length; i += 500)
        await sql`insert into kv_hash ${sql(rows.slice(i, i + 500))} on conflict (key, field) do update set value = excluded.value`;
      counts.hash++;
    } else if (type === "set") {
      const members = await cmd(["SMEMBERS", key]);
      const rows = members.map((member) => ({ key, member }));
      for (let i = 0; i < rows.length; i += 500) await sql`insert into kv_set ${sql(rows.slice(i, i + 500))} on conflict do nothing`;
      counts.set++;
    } else {
      console.warn(`skipped ${key}: type ${type} is not used by lib/kv.ts`);
      counts.skipped++;
    }
  }
} while (cursor !== "0");

console.log(`copied ${counts.string} strings, ${counts.hash} hashes, ${counts.set} sets; skipped ${counts.skipped}`);
await sql.end();
