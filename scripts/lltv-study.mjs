// LLTV study: how far each ETF has jumped between the close and the next open, what that means for a loan sitting at
// its LLTV, and which of Morpho's enabled LLTVs each token can carry. Writes public/verified/lltv-study.json.
//
//   node scripts/lltv-study.mjs
//
// Two price paths are measured for every night (weekends and holidays included):
//   frozen     the oracle repeats the last close until the open (what a market-hours-only feed does, and what Nightshift
//              falls back to if its own updates stop). The jump at the open is the full gap.
//   nightshift the anchor-only fair value at the open: last close × (1 + β × anchor move), with β measured from earlier
//              nights only (as in lib/beta.ts). The jump at the open is what's left after the oracle tracked the night.
//
// A loan opened at health 1.0 (debt = collateral × price × LLTV) leaves bad debt if the price falls more than
// 1 − LLTV × LIF before a liquidation can happen, where LIF = min(1.15, 1 / (0.3·LLTV + 0.7)), Morpho Blue's
// liquidation incentive. The jump at the open is the one move nobody can liquidate in the middle of.
import fs from "node:fs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const PAIRS = [
  { token: "SPY", anchor: "ES=F", anchorName: "S&P 500 futures", current: 0.77 },
  { token: "QQQ", anchor: "NQ=F", anchorName: "Nasdaq-100 futures", current: 0.77 },
  { token: "GLD", anchor: "GC=F", anchorName: "gold futures", current: 0.77 },
  { token: "IBIT", anchor: "BTC-USD", anchorName: "bitcoin", current: 0.625 },
  { token: "SLV", anchor: "SI=F", anchorName: "silver futures", current: 0.625 }, // not live yet; 62.5% is the study's pick (see lib/config.ts)
];
// LLTVs Morpho governance has enabled for new markets
const ENABLED = [0.385, 0.625, 0.77, 0.86, 0.915, 0.945, 0.965, 0.98];
const SAFETY = 1.5; // the worst jump on record, times this, must stay inside the bad-debt line
const SINCE = Date.UTC(2005, 0, 1) / 1000; // 20 years; older Yahoo opens are unreliable

const lif = (l) => Math.min(1.15, 1 / (0.3 * l + 0.7));
const badDebtDrop = (l) => 1 - l * lif(l);

async function chart(symbol, interval, query) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&${query}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.ok) {
      const r = (await res.json()).chart.result[0];
      const q = r.indicators.quote[0];
      return r.timestamp
        .map((t, i) => ({ t, o: q.open[i], c: q.close[i] }))
        .filter((b) => b.o > 0 && b.c > 0);
    }
    await new Promise((ok) => setTimeout(ok, 2000 * (attempt + 1)));
  }
  throw new Error(`Yahoo ${symbol} ${interval}: no data`);
}

/** Close of the last bar that finished by t (hourly bars). */
function anchorAt(bars, t) {
  let lo = 0, hi = bars.length - 1, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t + 3600 <= t) { best = bars[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return best && t - (best.t + 3600) < 4 * 3600 ? best.c : null; // no stale anchor (> 4h old)
}

function beta(xs, ys) {
  const n = xs.length;
  if (n < 10) return 1;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  if (!sxx || !syy) return 1;
  const raw = sxy / sxx, r2 = (sxy * sxy) / (sxx * syy);
  return r2 < 0.3 ? 1 : Math.max(0.5, Math.min(1.5, 0.67 * raw + 0.33));
}

const pct = (x) => Math.round(x * 1e4) / 100; // fraction → percent, 2 dp
function quantile(sorted, q) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0; }
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);

function summarize(nights, key) {
  const downs = nights.map((n) => -n[key]).filter((x) => x > 0).sort((a, b) => a - b); // falls only, as positive fractions
  const worst = [...nights].sort((a, b) => a[key] - b[key]).slice(0, 5).map((n) => ({ date: n.date, kind: n.kind, movePct: pct(n[key]) }));
  return {
    nights: nights.length,
    p99FallPct: pct(Math.max(0, -quantile(nights.map((n) => n[key]).sort((a, b) => a - b), 0.01))), // 1 night in 100 falls further
    worstFallPct: pct(downs.at(-1) ?? 0),
    worst,
    breachesByLltv: Object.fromEntries(ENABLED.map((l) => [l, nights.filter((n) => -n[key] > badDebtDrop(l)).length])),
  };
}

function recommend(worstFall) {
  const ok = ENABLED.filter((l) => badDebtDrop(l) > SAFETY * worstFall);
  return ok.length ? ok.at(-1) : null;
}

async function morphoComparison() {
  const q = (s) => `{ markets(first: 25, orderBy: SupplyAssetsUsd, orderDirection: Desc, where: { search: "${s}" }) { items { marketId lltv morphoBlue { chain { id } } collateralAsset { symbol name } loanAsset { symbol } state { supplyAssetsUsd } } } }`;
  const out = [];
  for (const s of ["SPY", "QQQ", "GLD", "IBIT", "xStock", "Robinhood Token", "Ondo Tokenized"]) {
    try {
      const res = await fetch("https://blue-api.morpho.org/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q(s) }) });
      for (const m of (await res.json()).data.markets.items) {
        const name = m.collateralAsset?.name ?? "";
        if (!/xStock|Robinhood Token|Ondo Tokenized|aStock|Backed/i.test(name)) continue; // tokenized stocks/ETFs as collateral only
        if ((m.state?.supplyAssetsUsd ?? 0) < 1000) continue; // skip empty test markets
        out.push({ chainId: m.morphoBlue.chain.id, collateral: m.collateralAsset.symbol, name, loan: m.loanAsset.symbol, lltv: Number(m.lltv) / 1e18, supplyUsd: Math.round(m.state.supplyAssetsUsd), marketId: m.marketId });
      }
    } catch (e) {
      console.warn(`Morpho API (${s}): ${e.message}`);
    }
  }
  const seen = new Set();
  return out.filter((m) => !seen.has(m.marketId) && seen.add(m.marketId)).sort((a, b) => b.supplyUsd - a.supplyUsd);
}

const tokens = [];
for (const p of PAIRS) {
  process.stdout.write(`${p.token}: `);
  const daily = await chart(p.token, "1d", `period1=${SINCE}&period2=${Math.floor(Date.now() / 1000)}`);
  // every close → next open; Yahoo stamps daily bars at the 09:30 ET open, so the close is 6.5 h later
  const nights = [];
  for (let i = 1; i < daily.length; i++) {
    const prev = daily[i - 1], cur = daily[i];
    const gapDays = Math.round((cur.t - prev.t) / 86400);
    nights.push({ date: day(cur.t), kind: gapDays === 1 ? "overnight" : gapDays === 3 && new Date(cur.t * 1000).getUTCDay() === 1 ? "weekend" : "holiday", frozen: cur.o / prev.c - 1, closeT: prev.t + 6.5 * 3600, openT: cur.t, prevClose: prev.c, open: cur.o });
  }
  // Nightshift residual over the last ~2 years (Yahoo keeps 730 days of hourly bars)
  const anchor = await chart(p.anchor, "1h", "range=730d");
  const xs = [], ys = [], tracked = [];
  for (const n of nights) {
    const a0 = anchorAt(anchor, n.closeT), a1 = anchorAt(anchor, n.openT);
    if (!a0 || !a1) continue;
    const b = beta(xs.slice(-60), ys.slice(-60)); // earlier nights only, about three months
    const fair = n.prevClose * (1 + b * (a1 / a0 - 1));
    tracked.push({ ...n, nightshift: n.open / fair - 1, frozenSame: n.frozen });
    xs.push(a1 / a0 - 1);
    ys.push(n.frozen);
  }
  const frozen = summarize(nights, "frozen");
  const ns = summarize(tracked, "nightshift");
  const frozenSameWindow = summarize(tracked, "frozenSame");
  const meanAbs = (arr, k) => pct(arr.reduce((s, n) => s + Math.abs(n[k]), 0) / Math.max(1, arr.length));
  tokens.push({
    token: p.token,
    anchor: p.anchorName,
    currentLltv: p.current,
    history: { from: nights[0].date, to: nights.at(-1).date, ...frozen },
    nightshiftWindow: {
      from: tracked[0]?.date, to: tracked.at(-1)?.date, nights: tracked.length,
      frozen: { ...frozenSameWindow, meanAbsPct: meanAbs(tracked, "frozenSame") },
      nightshift: { ...ns, meanAbsPct: meanAbs(tracked, "nightshift") },
    },
    recommended: { frozenFullHistory: recommend(downs(frozen)), nightshiftWindow: recommend(downs(ns)) },
  });
  console.log(`${nights.length} nights since ${nights[0].date}, worst frozen fall ${frozen.worstFallPct}%, ${tracked.length} tracked, worst Nightshift miss ${ns.worstFallPct}%`);
}
function downs(s) { return s.worstFallPct / 100; }

const morpho = await morphoComparison();
const out = {
  generatedAt: new Date().toISOString(),
  method: {
    badDebtLine: "A loan opened at health 1.0 leaves bad debt if the price falls more than 1 − LLTV × LIF before it can be liquidated; LIF = min(1.15, 1/(0.3·LLTV + 0.7)).",
    frozen: "Frozen oracle: the last close is repeated until the open, so the whole gap lands at once. Full history since 2005 (IBIT since its 2024 listing).",
    nightshift: "Nightshift: anchor-only fair value at the open, last close × (1 + β × anchor move), β from earlier nights only (60-night window, Blume-adjusted, R² ≥ 0.3). Last ~2 years (Yahoo's hourly limit). The anchor is read from the last full hourly bar before the open, so up to an hour stale: a conservative proxy for the live oracle, which also blends global markets, momentum and sentiment.",
    rule: `Recommended LLTV: the highest Morpho-enabled LLTV whose bad-debt line is more than ${SAFETY}× the worst fall on record.`,
    caveats: [
      "Past gaps are not a bound on future gaps.",
      "Assumes a liquidator acts at the open price; thin liquidity in tokenized ETFs could make the realized price worse.",
      "Early closes and halts are not modelled.",
    ],
  },
  enabledLltvs: ENABLED.map((l) => ({ lltv: l, lif: Math.round(lif(l) * 1e4) / 1e4, badDebtFallPct: pct(badDebtDrop(l)) })),
  tokens,
  morphoTokenizedMarkets: morpho,
};
const OUT = process.env.OUT ?? "public/verified/lltv-study.json"; // OUT=... writes somewhere else for a trial run
fs.mkdirSync(OUT.slice(0, OUT.lastIndexOf("/")), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${OUT} (${morpho.length} live Morpho tokenized-stock markets for comparison)`);
for (const t of tokens) console.log(`${t.token}: current ${t.currentLltv}, frozen-history → ${t.recommended.frozenFullHistory}, Nightshift-window → ${t.recommended.nightshiftWindow}`);
