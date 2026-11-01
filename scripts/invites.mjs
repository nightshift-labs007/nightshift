// Invite codes for Nightshift sign-up (team only: uses CRON_SECRET from .env.local).
//   node --env-file=.env.local scripts/invites.mjs create [count=1] [uses=1] [note]   new codes, each usable `uses` times
//   node --env-file=.env.local scripts/invites.mjs list                               every code, seats used, by whom
// SITE_URL=http://localhost:3000 points it at a local dev server instead of nightshift.buzz.
const SITE = (process.env.SITE_URL || "https://nightshift.buzz").replace(/\/$/, "");
const secret = process.env.CRON_SECRET?.trim();
if (!secret) throw new Error("CRON_SECRET is missing from .env.local");
const auth = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };
const [cmd = "list", ...args] = process.argv.slice(2);

async function call(method, body) {
  const res = await fetch(`${SITE}/api/admin/invites`, { method, headers: auth, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status}: ${j.error ?? "request failed"}`);
  return j;
}

if (cmd === "create") {
  const [count = "1", uses = "1", ...note] = args;
  const j = await call("POST", { count: Number(count), uses: Number(uses), note: note.join(" ") });
  console.log(`${j.codes.length} code(s), each usable ${j.uses} time(s):`);
  for (const c of j.codes) console.log(`  ${c}`);
} else if (cmd === "list") {
  const { invites } = await call("GET");
  if (!invites.length) console.log("No invite codes yet. Create some with: scripts/invites.mjs create 5");
  for (const i of invites)
    console.log(`${i.code}  ${String(i.used).padStart(3)}/${String(i.max).padEnd(4)} ${new Date(i.createdAt).toISOString().slice(0, 10)}  ${i.note}${i.usedBy.length ? `\n    used by ${i.usedBy.join(", ")}` : ""}`);
} else {
  console.log("usage: scripts/invites.mjs create [count] [uses] [note] | list");
}
