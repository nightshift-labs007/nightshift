// Phase 0 measurement for Nightshift Stack: how far the SLV price on Robinhood Chain's DEX pools sits from the
// Oracle's fair value (last close × (1 + β × silver-futures move since the close), the same anchor model as lib/oracle.ts).
// Uses DexPaprika's keyless last-24h hourly candles, so run it after a weekend (Sunday evening to Monday) for the gap
// that matters; with a DexPaprika key (DEXPAPRIKA_KEY) it can read 7+ days. Prints a table and the summary.
//
//   node scripts/dex-gap.mjs [hoursBack=24]
const NET = "https://api.dexpaprika.com/networks/robinhood/pools";
const POOLS = [
  { name: "SLV/USDG (V3)", id: "0x37ed4621d1eb3abc9e551a888e6aaf0a41f7be8e" },
  { name: "SLV/GLD (V3)", id: "0x48abc7052509caf820c4c22559f08381f9afd823" },
];
const BETA = 1.016; // measured over 20 nights, see docs/METALS_IMPLEMENTATION_PLAN.md
const UA = "Mozilla/5.0";
const hours = Number(process.argv[2] ?? 24);
const headers = process.env.DEXPAPRIKA_KEY ? { Authorization: process.env.DEXPAPRIKA_KEY } : {};

const j = async (url, h = {}) => { const r = await fetch(url, { headers: { "User-Agent": UA, ...h } }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); };
const yahoo = async (sym, interval, range) => {
  const r = (await j(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`)).chart.result[0];
  const q = r.indicators.quote[0];
  return r.timestamp.map((t, i) => ({ t, o: q.open[i], c: q.close[i] })).filter((b) => b.c > 0);
};

const [daily, fut] = await Promise.all([yahoo("SLV", "1d", "1mo"), yahoo("SI=F", "1h", "1mo")]);
const lastClose = daily.at(-1);
// the ETF's last regular close: Yahoo stamps daily bars at the 09:30 ET open; the close is 6.5 h later
const closeT = lastClose.t + 6.5 * 3600;
const futAt = (t) => { let h = null; for (const b of fut) { if (b.t + 3600 <= t) h = b; else break; } return h?.c ?? null; };
const f0 = futAt(closeT);
const fair = (t) => { const f = futAt(t); return f && f0 ? lastClose.c * (1 + BETA * (f / f0 - 1)) : null; };

console.log(`SLV last close ${lastClose.c.toFixed(2)} at ${new Date(closeT * 1000).toISOString()}; silver futures then ${f0?.toFixed(2)}\n`);
const start = new Date(Date.now() - hours * 3600e3).toISOString().slice(0, 19) + "Z";
for (const p of POOLS) {
  const info = await j(`${NET}/${p.id}`, headers);
  const bars = await j(`${NET}/${p.id}/ohlcv?start=${encodeURIComponent(start)}&limit=${hours + 2}&interval=1h`, headers).catch((e) => { console.log(`${p.name}: ${e.message}`); return []; });
  const rows = (Array.isArray(bars) ? bars : bars.ohlcv ?? []).map((b) => {
    const t = Math.floor(Date.parse(b.time_close ?? b.time_open ?? b.timestamp) / 1000);
    const dex = Number(b.close);
    const f = fair(t);
    return f && dex ? { t, dex, fair: f, gapBps: (dex / f - 1) * 1e4 } : null;
  }).filter(Boolean);
  const abs = rows.map((r) => Math.abs(r.gapBps)).sort((a, b) => a - b);
  const pick = (q) => abs.length ? abs[Math.min(abs.length - 1, Math.floor(q * abs.length))] : null;
  console.log(`${p.name}: liquidity $${Math.round(info.liquidity_usd)}, price now ${Number(info.last_price_usd).toFixed(3)}, ${rows.length} hourly candles`);
  if (rows.length) console.log(`  gap vs fair value (bps): median ${pick(0.5).toFixed(0)}, p90 ${pick(0.9).toFixed(0)}, max ${abs.at(-1).toFixed(0)}; mean signed ${(rows.reduce((s, r) => s + r.gapBps, 0) / rows.length).toFixed(0)}`);
}
