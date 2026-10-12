// Nightshift Engine N—01: a black-chrome, live-data engine that replaces the Roboky sentinel.
// Core = Oracle (with the sentinel's lens), rings = Vault / Guardian / Cloak, satellite = Ledger,
// conduits = the four signal models. Hooks into the scene's own controls (awaken, inspect, zoom, motion).
(() => {
  const stage = document.getElementById("robot-stage");
  const canvas = document.getElementById("engine-canvas");
  const overlay = document.getElementById("engine-overlay");
  const exp = document.getElementById("experience");
  if (!stage || !canvas || !overlay || !exp) return;
  const ctx = canvas.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- scene state ----------
  const S = {
    yaw: 0.42, pitch: -0.34, zoom: 1,
    tYaw: 0.42, tPitch: -0.34, tZoom: 1,
    look: { x: 0, y: 0, tx: -0.35, ty: -0.15 },
    awake: false, inspecting: false, paused: false,
    t: 0, energy: 0, hover: null, drag: null, kickGlow: 0, diving: false, started: false,
  };
  let W = 0, H = 0, dpr = 1;
  let snap = null;

  const RINGS = [
    { id: "vault", label: "VAULT", r: 1.62, tiltX: 1.18, tiltZ: 0.28, prec: 0.02, speed: 0.55, w: 8 },
    { id: "guardian", label: "GUARDIAN", r: 1.95, tiltX: 1.52, tiltZ: -0.62, prec: -0.015, speed: -0.42, w: 6.5 },
    { id: "cloak", label: "CLOAK", r: 2.28, tiltX: 0.86, tiltZ: 0.98, prec: 0.01, speed: 0.3, w: 5 },
  ];
  const CONDUITS = [
    { id: "anchor", label: "ANCHOR", x: 0.2, w: 0.6, hint: "Overnight futures or Bitcoin since the close" },
    { id: "global", label: "GLOBAL", x: 0.42, w: 0.2, hint: "Nikkei, DAX and FTSE since the close" },
    { id: "momentum", label: "MOMENTUM", x: 0.66, w: 0.1, hint: "Three-hour trend of the anchor" },
    { id: "sentiment", label: "SENTIMENT", x: 0.88, w: 0.1, hint: "Crypto Fear & Greed, day over day" },
  ];
  const TAGS = [
    { token: "SPY", ang: -2.55, dist: 3.15 },
    { token: "QQQ", ang: -0.62, dist: 3.25 },
    { token: "GLD", ang: 0.55, dist: 3.15 },
    { token: "IBIT", ang: 2.6, dist: 3.05 },
  ];
  const ROUTES = { core: "#oracle", anchor: "#oracle", global: "#oracle", momentum: "#oracle", sentiment: "#oracle", vault: "#vault", guardian: "#guardian", cloak: "#cloak", ledger: "#ledger" };
  const beads = RINGS.map((_, i) => ({ a: i * 2.1, hot: 0 }));

  // ---------- data ----------
  const fmt = (x, d = 2) => x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}%`;
  const quote = (t) => snap && snap.quotes.find((q) => q.token === t);
  function openLoans() {
    try {
      const a = JSON.parse(localStorage.getItem("nightshift.paper.v1") || "null");
      return a && a.positions ? a.positions.filter((p) => p.status === "open").length : 0;
    } catch (e) {
      return 0;
    }
  }
  let board = null;
  const stockOf = (t) => board && board.stocks.find((x) => x.ticker === t);
  async function loadStocks() {
    try {
      const r = await fetch("/api/stocks", { cache: "no-store" });
      board = await r.json();
    } catch (e) {
      /* keep the last board */
    }
  }
  async function load() {
    try {
      const r = await fetch("/api/oracle", { cache: "no-store" });
      const next = await r.json();
      const prev = snap;
      snap = next;
      renderTags(prev);
      const eb = document.getElementById("ns-eyebrow");
      if (eb) eb.textContent = snap.market.open ? "LIVE · NYSE OPEN" : `LIVE · NYSE CLOSED · ${snap.market.etTime.toUpperCase()}`;
      // a new oracle tick: fire a pulse down every conduit
      S.kickGlow = 1;
    } catch (e) {
      /* keep the last snapshot */
    }
  }

  // ---------- glass tags ----------
  const tagEls = TAGS.map((t) => {
    const el = document.createElement("button");
    el.className = "ns-tag glass";
    el.type = "button";
    el.innerHTML = `<small>${t.token} · FAIR VALUE</small><b>—</b><em></em>`;
    el.addEventListener("click", () => go("#oracle"));
    el.addEventListener("mouseenter", () => showTip("tag:" + t.token));
    el.addEventListener("mouseleave", () => hideTip());
    overlay.appendChild(el);
    return el;
  });
  function renderTags(prev) {
    TAGS.forEach((t, i) => {
      const q = quote(t.token);
      if (!q) return;
      const el = tagEls[i];
      el.querySelector("small").textContent = `${t.token} · ${q.marketOpen ? "LIVE" : "FAIR VALUE"}`;
      el.querySelector("b").textContent = `$${fmt(q.fairValue)}`;
      const em = el.querySelector("em");
      em.textContent = W < 700 ? pct(q.driftPct) : `${pct(q.driftPct)} · CONF ${q.confidence}`;
      em.className = q.driftPct >= 0 ? "up" : "down";
      const p = prev && prev.quotes.find((x) => x.token === t.token);
      if (p && p.fairValue !== q.fairValue) {
        el.classList.remove("flash");
        void el.offsetWidth;
        el.classList.add("flash");
      }
    });
  }

  // ---------- tooltip ----------
  const tip = document.createElement("div");
  tip.className = "ns-tip glass";
  overlay.appendChild(tip);
  let tipKey = null;
  function tipContent(key) {
    const spy = quote("SPY");
    if (key === "core" && morph() < 0.5) {
      return { k: "CORE / ETHEREUM", b: "Built for EVM chains", p: "Nightshift's contracts are written for Ethereum's virtual machine, so they can be deployed on any of the chains orbiting it. Start the engine to see it price the market.", i: "PRESS START THE ENGINE" };
    }
    if (key.startsWith("logo:")) {
      const k = key.slice(5);
      const c = CHAINS.find((x) => x.key === k);
      if (c) return { k: "NETWORK", b: c.name, p: `${c.body} Nightshift doesn’t sell tokens; availability depends on your country.`, i: `CLICK TO VISIT ${new URL(c.url).hostname.replace(/^www./, "").toUpperCase()} ↗` };
      const o = STOCK_ORBIT.find((x) => x.key === k);
      const st = o && stockOf(o.ticker);
      if (!st) return { k: o ? o.ticker : k, b: "—", p: "Waiting for stock data.", i: "" };
      return {
        k: `${st.ticker} / ${st.name.toUpperCase()}`,
        b: `$${fmt(st.fairValue)}`,
        p: st.marketOpen
          ? `Market open: live price. Last session ${pct(st.dayChangePct)}.`
          : `Nightshift overnight value, ${pct(st.driftPct)} vs the $${fmt(st.lastClose)} close. Beta ${st.beta.toFixed(2)} to ${st.anchorName}.`,
        i: `CONFIDENCE ${st.confidence}/100 · CLICK FOR THE ANALYSIS ↗`,
      };
    }
    if (key === "core") {
      return { k: "ORACLE CORE", b: spy ? `SPY $${fmt(spy.fairValue)}` : "Oracle", p: `Fair value blended from four signal models, recomputed every minute. The aperture opens wider the more confident the Oracle is${spy ? ` (now ${spy.confidence}/100).` : "."}`, i: "CLICK TO OPEN THE ORACLE ↗" };
    }
    if (key === "vault") {
      const lim = spy ? Math.min(spy.fairValue, spy.lastClose) * spy.lltv * (1 - (100 - spy.confidence) / 200) : 0;
      return { k: "RING 01 / VAULT", b: spy ? `$${fmt(lim)} limit per SPY` : "Vault", p: "Loans are sized and marked by the Oracle price, under Morpho Blue lending and liquidation rules.", i: "CLICK TO OPEN THE VAULT ↗" };
    }
    if (key === "guardian") {
      const n = openLoans();
      return { k: "RING 02 / GUARDIAN", b: `${n} loan${n === 1 ? "" : "s"} watched`, p: "Every loan is re-checked on each Oracle update. It alerts, or repays automatically, before liquidation.", i: "CLICK TO OPEN THE GUARDIAN ↗" };
    }
    if (key === "cloak") {
      return { k: "RING 03 / CLOAK", b: "Groth16 · 918 constraints", p: "Proves a loan is solvent at the Oracle price without revealing its size or liquidation level.", i: "CLICK TO OPEN THE CLOAK ↗" };
    }
    if (key === "ledger") {
      return { k: "SATELLITE / LEDGER", b: "Algorand TestNet", p: "Each pre-open prediction is stamped on-chain before the bell, so the record can't be edited later.", i: "CLICK TO OPEN THE LEDGER ↗" };
    }
    if (key.startsWith("tag:")) {
      const q = quote(key.slice(4));
      return q
        ? { k: `${q.token} / ${q.name.toUpperCase()}`, b: `$${fmt(q.fairValue)}`, p: `Frozen close $${fmt(q.lastClose)}. ${q.anchorName} ${pct(q.anchorMovePct)} since the close.`, i: `CONFIDENCE ${q.confidence}/100` }
        : { k: key.slice(4), b: "—", p: "Waiting for the first Oracle tick.", i: "" };
    }
    const c = CONDUITS.find((x) => x.id === key);
    if (c) {
      const a = spy && spy.agents.find((x) => x.id === c.id);
      const mv = a && spy ? pct((a.estimate / spy.lastClose - 1) * 100) : "—";
      return { k: `SIGNAL / ${c.label}`, b: a ? `SPY ${mv} vs close` : spy && spy.marketOpen ? "Market open" : "Signal", p: `${c.hint}. Weight ${Math.round(c.w * 100)}% of the fair value.`, i: "FEEDS THE ORACLE CORE" };
    }
    return null;
  }
  function showTip(key, x, y) {
    const c = tipContent(key);
    if (!c) return hideTip();
    if (tipKey !== key) {
      tip.innerHTML = `<small>${c.k}</small><b>${c.b}</b><p>${c.p}</p>${c.i ? `<i>${c.i}</i>` : ""}`;
      tipKey = key;
    }
    if (x !== undefined) {
      const tw = tip.offsetWidth || 260;
      const th = tip.offsetHeight || 120;
      // logos swell on hover, so their card sits beside the bubble rather than over it
      const side = key.startsWith("logo:") ? 58 : 18;
      const left = x + side + tw > W - 12 ? x - side - tw : x + side;
      tip.style.left = `${Math.min(W - tw - 12, Math.max(12, left))}px`;
      tip.style.top = `${Math.min(H - th - 12, Math.max(12, key.startsWith("logo:") ? y - th / 2 : y - th - 14))}px`;
    } else if (key.startsWith("tag:")) {
      const el = tagEls[TAGS.findIndex((t) => "tag:" + t.token === key)];
      const r = el.getBoundingClientRect();
      const sr = stage.getBoundingClientRect();
      tip.style.left = `${Math.min(W - 280, Math.max(12, r.left - sr.left))}px`;
      tip.style.top = `${Math.max(12, r.top - sr.top - (tip.offsetHeight || 120) - 10)}px`;
    }
    tip.classList.add("on");
  }
  function hideTip() {
    tip.classList.remove("on");
    tipKey = null;
  }
  // "Inspect the engine": widen the stage, fade the page away, zoom the camera into the eye,
  // then cut to black and open the analysis page
  function diveInto(url) {
    if (S.diving) return;
    if (reduced) return goPage(url);
    S.diving = true;
    S.kickGlow = 1;
    S.look.tx = 0;
    S.look.ty = 0;
    hideTip();
    exp.classList.add("ns-diving");
    document.documentElement.classList.add("ns-diving");
    S.tZoom = 5.2;
    const veil = document.createElement("div");
    veil.className = "ns-veil";
    document.body.appendChild(veil);
    setTimeout(() => veil.classList.add("on"), 950);
    setTimeout(() => goPage(url), 1500);
  }
  function goPage(url) {
    try {
      (window.top || window).location.href = url;
    } catch (e) {
      window.location.href = url;
    }
  }
  function go(hash) {
    try {
      if (window.top !== window && window.top.document.querySelector(hash)) {
        window.top.document.querySelector(hash).scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    } catch (e) {
      /* cross-origin parent: fall through */
    }
    window.location.href = "/" + hash;
  }

  // ---------- 3D helpers ----------
  const rotX = (p, a) => ({ x: p.x, y: p.y * Math.cos(a) - p.z * Math.sin(a), z: p.y * Math.sin(a) + p.z * Math.cos(a) });
  const rotY = (p, a) => ({ x: p.x * Math.cos(a) + p.z * Math.sin(a), y: p.y, z: -p.x * Math.sin(a) + p.z * Math.cos(a) });
  const rotZ = (p, a) => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a), z: p.z });
  function geo() {
    const narrow = W < 700;
    const R = Math.min(W, H) * (narrow ? 0.14 : 0.132) * S.zoom;
    return { cx: W * (narrow ? 0.5 : 0.5), cy: H * (narrow ? 0.4 : 0.42), R, narrow };
  }
  function world(p) {
    return rotX(rotY(p, S.yaw + S.look.x * 0.12), S.pitch + S.look.y * 0.08);
  }
  function project(p, g) {
    const s = 1100 / Math.max(160, 1100 - p.z); // never let a point pass behind the camera
    return { x: g.cx + p.x * s, y: g.cy + p.y * s, z: p.z, s };
  }
  function ringPoint(ring, ang, g) {
    let p = { x: Math.cos(ang) * ring.r * g.R, y: Math.sin(ang) * ring.r * g.R, z: 0 };
    p = rotX(p, ring.tiltX);
    p = rotZ(p, ring.tiltZ + S.t * ring.prec);
    return project(world(p), g);
  }

  // ---------- drawing: mechanical eye + holographic wireframe ----------
  const SEG = 180;
  const INK = "232,240,236";
  const MINT = "196,236,217";
  const AMBER = "255,150,62";

  // the iris is a fixed circuit board: radial traces that bend once and end on a pad
  const IRIS = (() => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const traces = [];
    const N = 34;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2 + (rnd() - 0.5) * 0.08;
      const r0 = 0.34;
      const r1 = 0.5 + rnd() * 0.22;
      const da = (rnd() - 0.5) * 0.5;
      const r2 = Math.min(0.9, r1 + 0.08 + rnd() * 0.16);
      const pts = [[r0, a0], [r1, a0]];
      const steps = 6;
      for (let k = 1; k <= steps; k++) pts.push([r1, a0 + (da * k) / steps]);
      if (rnd() > 0.35) pts.push([r2, a0 + da]);
      traces.push({ pts, phase: rnd() * 3, speed: 0.18 + rnd() * 0.22 });
    }
    return traces;
  })();

  function drawRing(ring, g, front, ri) {
    const pts = [];
    for (let i = 0; i <= SEG; i++) pts.push(ringPoint(ring, (i / SEG) * Math.PI * 2, g));
    const inner = [];
    const r2 = { ...ring, r: ring.r - 0.07 };
    for (let i = 0; i <= SEG; i++) inner.push(ringPoint(r2, (i / SEG) * Math.PI * 2, g));
    const hot = S.hover === ring.id;
    const a = front ? (hot ? 0.75 : 0.34) : hot ? 0.26 : 0.08;
    const strokeHalf = (list, alpha, width) => {
      ctx.lineWidth = width;
      ctx.strokeStyle = `rgba(${MINT},${alpha})`;
      ctx.beginPath();
      let open = false;
      for (let i = 0; i < SEG; i++) {
        if (front !== (list[i].z + list[i + 1].z) / 2 >= 0) {
          open = false;
          continue;
        }
        if (!open) {
          ctx.moveTo(list[i].x, list[i].y);
          open = true;
        }
        ctx.lineTo(list[i + 1].x, list[i + 1].y);
      }
      ctx.stroke();
    };
    strokeHalf(pts, a, hot ? 1.3 : 1);
    strokeHalf(inner, a * 0.5, 0.8);
    // wireframe ribs between the two rails
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = `rgba(${MINT},${a * 0.55})`;
    ctx.beginPath();
    for (let i = 0; i < SEG; i += 6) {
      if (front !== pts[i].z >= 0) continue;
      ctx.moveTo(pts[i].x, pts[i].y);
      ctx.lineTo(inner[i].x, inner[i].y);
    }
    ctx.stroke();
    // one amber panel travelling around each system
    const span = 0.32;
    ctx.lineWidth = front ? 2.2 : 1.4;
    ctx.lineCap = "round";
    ctx.strokeStyle = `rgba(${AMBER},${front ? 0.55 + S.energy * 0.35 : 0.16})`;
    ctx.beginPath();
    let open = false;
    for (let k = 0; k <= 16; k++) {
      const p = ringPoint(ring, beads[ri].a + (k / 16) * span, g);
      if (front !== p.z >= 0) {
        open = false;
        continue;
      }
      if (!open) {
        ctx.moveTo(p.x, p.y);
        open = true;
      } else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.lineCap = "butt";
    return pts;
  }

  function ringLabel(ring, g) {
    // only the hovered system is labelled
    if (S.hover !== ring.id) return;
    let best = null;
    for (let i = 0; i < 48; i++) {
      const p = ringPoint(ring, (i / 48) * Math.PI * 2, g);
      if (p.z >= 0 && (!best || p.x > best.x)) best = p;
    }
    if (!best) return;
    ctx.font = "500 10px Mono, monospace";
    ctx.fillStyle = `rgba(${INK},0.85)`;
    ctx.fillText(ring.label, best.x + 10, best.y + 3);
  }

  function coreRadius(g) {
    return g.R * 0.9;
  }

  // ---------- signal conduits: four traces rising from the platform into the eye ----------
  function conduitPaths(g) {
    const r = coreRadius(g);
    const platY = g.cy + g.R * 1.95;
    const offs = [-0.78, -0.26, 0.26, 0.78];
    return CONDUITS.map((c, i) => {
      const xo = offs[i] * g.R;
      const xEnd = xo * 0.62;
      const edgeY = g.cy + Math.sqrt(Math.max(0, r * r - xEnd * xEnd)) - 2;
      const bendY = platY - g.R * 0.32;
      const turnY = bendY - Math.abs(xo * 1.8 - xEnd);
      return {
        id: c.id,
        w: c.w,
        pts: [
          [g.cx + xo * 1.8, platY],
          [g.cx + xo * 1.8, bendY],
          [g.cx + xEnd, Math.max(edgeY, turnY)],
          [g.cx + xEnd, edgeY],
        ],
      };
    });
  }
  function pointAlong(pts, f) {
    let total = 0;
    const lens = [];
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      lens.push(l);
      total += l;
    }
    let d = f * total;
    for (let i = 0; i < lens.length; i++) {
      if (d <= lens[i] || i === lens.length - 1) {
        const t = lens[i] ? Math.min(1, d / lens[i]) : 0;
        return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
      }
      d -= lens[i];
    }
    return pts[pts.length - 1];
  }
  let conduits = [];
  function drawPlatform(g) {
    const y = g.cy + g.R * 1.95;
    const R = g.R;
    const quad = (fw, bw, d) => {
      ctx.beginPath();
      ctx.moveTo(g.cx - fw * R, y + d * R);
      ctx.lineTo(g.cx + fw * R, y + d * R);
      ctx.lineTo(g.cx + bw * R, y - d * R);
      ctx.lineTo(g.cx - bw * R, y - d * R);
      ctx.closePath();
    };
    const fill = ctx.createLinearGradient(0, y - 0.22 * R, 0, y + 0.22 * R);
    fill.addColorStop(0, `rgba(${AMBER},0.0)`);
    fill.addColorStop(1, `rgba(${AMBER},${0.05 + S.energy * 0.04})`);
    quad(2.3, 1.75, 0.22);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${AMBER},${0.32 + S.energy * 0.2})`;
    ctx.stroke();
    quad(1.95, 1.5, 0.14);
    ctx.strokeStyle = `rgba(${MINT},0.1)`;
    ctx.stroke();
  }
  function drawConduits(g) {
    conduits = conduitPaths(g);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    conduits.forEach((c, i) => {
      const hot = S.hover === c.id;
      const path = () => {
        ctx.beginPath();
        c.pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      };
      path();
      ctx.lineWidth = 5 + c.w * 6;
      ctx.strokeStyle = `rgba(${AMBER},${0.04 + (hot ? 0.06 : 0)})`;
      ctx.stroke();
      path();
      ctx.lineWidth = 0.8 + c.w * 1.6;
      ctx.strokeStyle = `rgba(${AMBER},${hot ? 0.85 : 0.3 + S.energy * 0.2})`;
      ctx.stroke();
      // pad where the signal enters the platform
      const [px, py] = c.pts[0];
      ctx.fillStyle = `rgba(${AMBER},${hot ? 0.9 : 0.5})`;
      ctx.fillRect(px - 2.5, py - 2.5, 5, 5);
      // data pulses travel up into the eye: one burst per Oracle tick, a slow trickle while running
      const pulses = [];
      if (S.kickGlow > 0) pulses.push([1 - S.kickGlow, 1]);
      if (S.energy > 0.05) pulses.push([(S.t * 0.4 + i * 0.27) % 1, S.energy * 0.7]);
      pulses.forEach(([f, k]) => {
        const [x, y] = pointAlong(c.pts, f);
        const glow = ctx.createRadialGradient(x, y, 0, x, y, 9);
        glow.addColorStop(0, `rgba(${AMBER},${0.9 * k})`);
        glow.addColorStop(1, `rgba(${AMBER},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fill();
      });
      if (hot) {
        ctx.font = "500 10px Mono, monospace";
        ctx.fillStyle = `rgba(${INK},0.85)`;
        ctx.fillText(CONDUITS[i].label, px + 8, py + 16);
      }
    });
    ctx.restore();
  }

  // the eye's aperture follows the Oracle: wide open while the market trades,
  // narrower as confidence falls overnight, and it blinks now and then
  function aperture() {
    const spy = quote("SPY");
    let open = 0.78;
    if (spy) open = spy.marketOpen ? 0.9 : 0.5 + 0.38 * (spy.confidence / 100);
    open = 0.95 + (open - 0.95) * morph();
    const ph = S.t % 9.5;
    const blink = ph < 0.42 ? Math.sin((ph / 0.42) * Math.PI) : 0;
    const focus = S.kickGlow * 0.18 * Math.sin((1 - S.kickGlow) * Math.PI * 2);
    return Math.max(0.06, open * (1 - blink * 0.93) - focus);
  }

  // live prices written around the eye, spaced to close the circle exactly
  function hudTexts() {
    if (!snap) return ["NIGHTSHIFT ORACLE · WAITING FOR THE FIRST TICK · "];
    const spy = quote("SPY");
    const conf = `CONF ${spy ? spy.confidence : "—"}`;
    const mk = snap.market.open ? "NYSE OPEN" : "NYSE CLOSED";
    const long = snap.quotes.map((q) => `${q.token} ${fmt(q.fairValue)} ${pct(q.driftPct)}`).join(" · ");
    const short = snap.quotes.map((q) => `${q.token} ${fmt(q.fairValue)}`).join(" · ");
    return [`${long} · ${conf} · ${mk} · `, `${short} · ${conf} · ${mk} · `, `${short} · `];
  }
  function arcText(cx, cy, radius, start, alpha) {
    ctx.font = "500 9px Mono, monospace";
    const room = Math.PI * 2 * radius;
    const opts = hudTexts();
    let text = opts[opts.length - 1];
    for (const t of opts) {
      if ([...t].reduce((w, ch) => w + ctx.measureText(ch).width + 1, 0) <= room * 0.97) {
        text = t;
        break;
      }
    }
    const chars = [...text];
    const widths = chars.map((ch) => ctx.measureText(ch).width + 1);
    const used = widths.reduce((x, y) => x + y, 0);
    const extra = Math.max(0, (room - used) / chars.length);
    ctx.fillStyle = `rgba(${INK},${alpha})`;
    ctx.textAlign = "center";
    let a = start;
    chars.forEach((ch, i) => {
      const step = (widths[i] + extra) / radius;
      a += step / 2;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      a += step / 2;
    });
    ctx.textAlign = "start";
  }

  // a holographic beam from the platform up into the eye
  function drawProjection(g) {
    const r = coreRadius(g);
    const baseY = g.cy + g.R * 1.95 - g.R * 0.22;
    const topY = g.cy + r * 0.55;
    const R = g.R;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(g.cx - 1.55 * R, baseY);
    ctx.lineTo(g.cx + 1.55 * R, baseY);
    ctx.lineTo(g.cx + r * 0.7, topY);
    ctx.lineTo(g.cx - r * 0.7, topY);
    ctx.closePath();
    ctx.clip();
    const k = 0.5 + S.energy * 0.5 + S.kickGlow * 0.4;
    const beam = ctx.createLinearGradient(0, baseY, 0, topY);
    beam.addColorStop(0, `rgba(${AMBER},${0.1 * k})`);
    beam.addColorStop(1, `rgba(${AMBER},${0.015 * k})`);
    ctx.fillStyle = beam;
    ctx.fillRect(g.cx - 2 * R, topY, 4 * R, baseY - topY);
    // scan lines rising through the beam
    ctx.lineWidth = 1;
    const gap = 7;
    const off = (S.t * 18) % gap;
    for (let y = baseY - off; y > topY; y -= gap) {
      const f = (baseY - y) / (baseY - topY);
      ctx.strokeStyle = `rgba(${AMBER},${(1 - f) * 0.09 * k})`;
      ctx.beginPath();
      ctx.moveTo(g.cx - 2 * R, y);
      ctx.lineTo(g.cx + 2 * R, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCore(g) {
    const { cx, cy } = g;
    const r = coreRadius(g);
    const hot = S.hover === "core";

    // shockwave on every Oracle tick
    if (S.kickGlow > 0) {
      const p = 1 - S.kickGlow;
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = `rgba(${AMBER},${0.45 * S.kickGlow})`;
      ctx.beginPath();
      ctx.arc(cx, cy, r * (1.05 + p * 2.2), 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(${MINT},${0.2 * S.kickGlow})`;
      ctx.beginPath();
      ctx.arc(cx, cy, r * (1.05 + p * 1.5), 0, Math.PI * 2);
      ctx.stroke();
    }

    // HUD: a measuring scale and a ribbon of live prices
    const scaleR = r * 1.12;
    const rot = -S.t * 0.04;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 144; i++) {
      const a = rot + (i / 144) * Math.PI * 2;
      const len = i % 12 === 0 ? 7 : i % 3 === 0 ? 3.5 : 1.8;
      ctx.moveTo(cx + Math.cos(a) * scaleR, cy + Math.sin(a) * scaleR);
      ctx.lineTo(cx + Math.cos(a) * (scaleR + len), cy + Math.sin(a) * (scaleR + len));
    }
    ctx.strokeStyle = `rgba(${MINT},${hot ? 0.4 : 0.22})`;
    ctx.stroke();
    arcText(cx, cy, r * 1.12 + 17, S.t * 0.05 - Math.PI / 2, hot ? 0.75 : 0.42);

    // housing: black chrome with a segmented bezel
    const body = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.45, r * 0.05, cx, cy, r);
    body.addColorStop(0, "#262d2c");
    body.addColorStop(0.6, "#0e1212");
    body.addColorStop(1, "#060808");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${INK},${hot ? 0.4 : 0.16})`;
    ctx.stroke();
    const SEGS = 28;
    ctx.lineWidth = r * 0.07;
    for (let i = 0; i < SEGS; i++) {
      const a0 = (i / SEGS) * Math.PI * 2 + S.t * 0.03;
      ctx.strokeStyle = i % 7 === 0 ? `rgba(${AMBER},${0.35 + S.energy * 0.45 + S.kickGlow * 0.2})` : `rgba(${INK},0.07)`;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.9, a0, a0 + (Math.PI * 2) / SEGS - 0.05);
      ctx.stroke();
    }

    // lens: sits in the housing and turns toward the cursor
    const rl = r * 0.76;
    const lx = cx + S.look.x * r * 0.08;
    const ly = cy + S.look.y * r * 0.07;
    const lens = ctx.createRadialGradient(lx, ly, rl * 0.1, lx, ly, rl);
    lens.addColorStop(0, "#170c05");
    lens.addColorStop(0.7, "#0a0807");
    lens.addColorStop(1, "#040505");
    ctx.fillStyle = lens;
    ctx.beginPath();
    ctx.arc(lx, ly, rl, 0, Math.PI * 2);
    ctx.fill();

    // iris: amber circuit traces, brighter while running and on every Oracle tick
    const ix = lx + S.look.x * r * 0.12;
    const iy = ly + S.look.y * r * 0.1;
    const lit = 0.3 + S.energy * 0.32 + S.kickGlow * 0.35 + (hot ? 0.1 : 0);
    const spin = S.t * 0.02;
    const at = ([pr, pa]) => [ix + Math.cos(pa + spin) * pr * rl, iy + Math.sin(pa + spin) * pr * rl];
    ctx.save();
    ctx.beginPath();
    ctx.arc(lx, ly, rl * 0.97, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(ix, iy, rl * 0.18, ix, iy, rl * 0.75);
    halo.addColorStop(0, `rgba(${AMBER},${0.22 * lit + 0.05})`);
    halo.addColorStop(1, `rgba(${AMBER},0)`);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(ix, iy, rl * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = `rgba(${AMBER},${lit})`;
    ctx.fillStyle = `rgba(${AMBER},${Math.min(1, lit + 0.2)})`;
    ctx.beginPath();
    IRIS.forEach((tr) => {
      tr.pts.forEach((p, k) => {
        const [x, y] = at(p);
        if (k) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
    });
    ctx.stroke();
    IRIS.forEach((tr) => {
      const [x, y] = at(tr.pts[tr.pts.length - 1]);
      ctx.fillRect(x - 1.6, y - 1.6, 3.2, 3.2);
    });
    if (!S.paused) {
      IRIS.forEach((tr, k) => {
        if (k % 3) return;
        const f = (S.t * tr.speed + tr.phase) % 1.4;
        if (f > 1) return;
        const [x, y] = pointAlong(tr.pts.map(at), f);
        ctx.fillStyle = `rgba(255,214,170,${0.35 + S.energy * 0.5})`;
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    // the eyeball (inner ring, pupil and its live core) only appears once the engine runs;
    // at rest the Ethereum crystal takes its place
    const eyeball = morph();
    ctx.globalAlpha = eyeball;
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = `rgba(${AMBER},${Math.min(1, lit + 0.25)})`;
    ctx.beginPath();
    ctx.arc(ix, iy, rl * 0.32, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";

    // pupil with a small live core
    ctx.fillStyle = "#030303";
    ctx.beginPath();
    ctx.arc(ix, iy, rl * 0.26, 0, Math.PI * 2);
    ctx.fill();
    const beat = 0.5 + 0.5 * Math.sin(S.t * (1.4 + S.energy * 1.6));
    const dotR = rl * (0.05 + S.energy * 0.015) * (1 + S.kickGlow * 0.5);
    const coreGlow = ctx.createRadialGradient(ix, iy, 0, ix, iy, dotR * 3);
    coreGlow.addColorStop(0, `rgba(255,200,150,${0.75 + beat * 0.25})`);
    coreGlow.addColorStop(0.35, `rgba(${AMBER},${0.5 + beat * 0.2})`);
    coreGlow.addColorStop(1, `rgba(${AMBER},0)`);
    ctx.fillStyle = coreGlow;
    ctx.beginPath();
    ctx.arc(ix, iy, dotR * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Ethereum inside the eye: it fills the lens at rest, then settles into the pupil once the engine runs
    {
      const m = morph();
      drawEthGlyph(lx + (ix - lx) * m, ly + (iy - ly) * m, rl * (1.05 - 0.6 * m), 0.45 + 0.3 * (1 - m) + S.kickGlow * 0.3);
    }

    // shutter: eight blades close over the iris; the opening tracks the Oracle's confidence
    const N = 8;
    const ap = aperture() * rl;
    const bladeRot = 0.3 + (1 - ap / rl) * 1.4;
    const verts = [];
    for (let k = 0; k < N; k++) {
      const a = bladeRot + (k / N) * Math.PI * 2;
      verts.push([lx + Math.cos(a) * ap, ly + Math.sin(a) * ap]);
    }
    ctx.beginPath();
    ctx.arc(lx, ly, rl * 1.01, 0, Math.PI * 2);
    verts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    const blade = ctx.createRadialGradient(lx - rl * 0.3, ly - rl * 0.4, 0, lx, ly, rl);
    blade.addColorStop(0, "#1f2524");
    blade.addColorStop(1, "#0a0c0c");
    ctx.fillStyle = blade;
    ctx.fill("evenodd");
    // blade seams: each opening edge runs on out to the rim
    ctx.lineWidth = 1;
    for (let k = 0; k < N; k++) {
      const [ax, ay] = verts[k];
      const [bx, by] = verts[(k + 1) % N];
      const dx = bx - ax;
      const dy = by - ay;
      const L = Math.hypot(dx, dy) || 1;
      ctx.strokeStyle = `rgba(${AMBER},${0.28 + S.kickGlow * 0.3})`;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.strokeStyle = `rgba(${INK},0.12)`;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + (dx / L) * rl * 2, by + (dy / L) * rl * 2);
      ctx.stroke();
    }
    ctx.restore();

    // lens rim and glass reflection
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${INK},${hot ? 0.45 : 0.22})`;
    ctx.beginPath();
    ctx.arc(lx, ly, rl, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.beginPath();
    ctx.arc(lx, ly, rl * 0.86, -2.75, -1.55);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.beginPath();
    ctx.arc(lx, ly, rl * 0.78, 0.5, 0.95);
    ctx.stroke();
  }

  function drawLedger(g, front) {
    const a = S.t * (0.35 + S.energy * 0.3);
    let p = { x: Math.cos(a) * g.R * 1.3, y: Math.sin(a) * g.R * 1.3, z: 0 };
    p = rotX(p, 1.25);
    p = rotZ(p, -0.35);
    const q = project(world(p), g);
    if (front !== q.z >= 0) return q;
    const s = 3.2;
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${MINT},${front ? (S.hover === "ledger" ? 0.95 : 0.6) : 0.2})`;
    ctx.strokeRect(q.x - s, q.y - s, s * 2, s * 2);
    if (front && S.hover === "ledger") {
      ctx.font = "500 10px Mono, monospace";
      ctx.fillStyle = `rgba(${INK},0.85)`;
      ctx.fillText("LEDGER", q.x + 10, q.y + 3);
    }
    return q;
  }

  function placeTags(g) {
    TAGS.forEach((t, i) => {
      const el = tagEls[i];
      const bob = Math.sin(S.t * 0.5 + i * 1.7) * 2;
      const dist = (t.dist * g.R) / S.zoom * Math.max(1, S.zoom * 0.9);
      let x = g.cx + Math.cos(t.ang) * dist * 1.08;
      let y = g.cy + Math.sin(t.ang) * dist * 0.62 + bob;
      if (g.narrow) {
        x = g.cx + Math.cos(t.ang) * Math.min(dist, W * 0.36);
        y = g.cy + Math.sin(t.ang) * g.R * 2.1 + bob;
      }
      const hw = (el.offsetWidth || 120) / 2 + 6;
      const hh = (el.offsetHeight || 60) / 2 + 6;
      x = Math.max(hw, Math.min(W - hw, x));
      y = Math.max(hh, Math.min(H - hh, y));
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.opacity = S.diving ? "0" : S.inspecting && S.zoom > 1.4 ? "0.25" : "1";
    });
  }

  // ---------- the atom: brand logos orbiting the core ----------
  // At rest the core is Ethereum with the chains Nightshift can run on; once the engine starts,
  // the core becomes the eye and the world's largest stocks take the orbits.
  const LOGO = window.NS_LOGOS || {};
  const CHAINS = [
    { key: "HOOD_CHAIN", url: "https://robinhood.com/", ring: 0, a: 0.2, name: "Robinhood Chain", body: "Robinhood's Arbitrum-based network for tokenized stocks: Nightshift's target home." },
    { key: "SOLANA", url: "https://solana.com/", ring: 0, a: 3.3, name: "Solana", body: "High-throughput chain where tokenized stocks already trade around the clock. A candidate network." },
    { key: "COINBASE", url: "https://www.coinbase.com/", ring: 1, a: 1.1, name: "Coinbase · Base", body: "Base, Coinbase's Ethereum layer 2, runs the Nightshift testnet contracts (Base Sepolia)." },
    { key: "ARC", url: "https://www.arc.network/", ring: 1, a: 4.2, name: "Arc by Circle", body: "Circle's open, EVM-compatible Layer-1 for stablecoins. USDC is the gas token, so fees are predictable in dollars, and finality is deterministic and sub-second. Built for lending, capital markets, FX and payments: a candidate network for settling Nightshift's stablecoin loans against tokenized stocks." },
    { key: "BINANCE", url: "https://www.binance.com/", ring: 2, a: 2.4, name: "BNB Chain", body: "Binance's chain, with deep crypto liquidity. A candidate network." },
  ];
  const STOCK_ORBIT = [
    { key: "AAPL", ticker: "AAPL", ring: 0, a: 0.3 },
    { key: "TSLA", ticker: "TSLA", ring: 0, a: 2.4 },
    { key: "META", ticker: "META", ring: 0, a: 4.5 },
    { key: "NVDA", ticker: "NVDA", ring: 1, a: 1.0 },
    { key: "GOOGL", ticker: "GOOGL", ring: 1, a: 4.1 },
    { key: "MSFT", ticker: "MSFT", ring: 2, a: 0.6 },
    { key: "NFLX", ticker: "NFLX", ring: 2, a: 3.7 },
  ];
  const paths = {};
  const pathOf = (key) => {
    if (!paths[key] && LOGO[key]) paths[key] = new Path2D(LOGO[key].path);
    return paths[key];
  };
  const hoverAmt = {};
  let logoHits = [];
  const hexRgb = (hex) => {
    const n = parseInt((hex || "#c4ecd9").slice(1), 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  };
  const smooth = (x) => x * x * (3 - 2 * x);
  const morph = () => smooth(Math.max(0, Math.min(1, S.energy)));

  function orbitPoint(ring, ang, g, k) {
    let p = { x: Math.cos(ang) * ring.r * k * g.R, y: Math.sin(ang) * ring.r * k * g.R, z: 0 };
    p = rotX(p, ring.tiltX);
    p = rotZ(p, ring.tiltZ + S.t * ring.prec);
    return project(world(p), g);
  }

  function logoPositions(g) {
    const m = morph();
    const out = [];
    const add = (list, k, alpha, set) =>
      alpha > 0.02 &&
      list.forEach((o) => {
        const ring = RINGS[o.ring];
        const ang = o.a + S.t * ring.speed * 0.35 * (1 + S.energy * 0.6);
        const p = orbitPoint(ring, ang, g, k);
        out.push({ ...o, set, x: p.x, y: p.y, z: p.z, s: p.s, alpha });
      });
    add(CHAINS, 1 + 1.7 * m, 1 - m, "chain");
    add(STOCK_ORBIT, 2.7 - 1.7 * m, m, "stock");
    return out;
  }

  // a liquid-glass bubble in the brand's colour; amt (0..1) swells and wobbles it on hover
  function drawLogo(o, front) {
    const id = "logo:" + o.key;
    const amt = hoverAmt[id] || 0;
    const brand = hexRgb(LOGO[o.key] && LOGO[o.key].hex);
    const base = 16 * o.s;
    const R = base * (1 + 1.25 * amt);
    const depth = front ? 1 : 0.5;
    ctx.save();
    ctx.globalAlpha = o.alpha * depth;

    if (amt > 0.01) {
      const glow = ctx.createRadialGradient(o.x, o.y, R * 0.6, o.x, o.y, R * 2);
      glow.addColorStop(0, `rgba(${brand},${0.32 * amt})`);
      glow.addColorStop(1, `rgba(${brand},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(o.x, o.y, R * 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // the body: a wobbling blob, still a perfect circle at rest
    const seed = o.key.length * 1.7;
    ctx.beginPath();
    for (let i = 0; i <= 72; i++) {
      const th = (i / 72) * Math.PI * 2;
      const wob = amt * (0.075 * Math.sin(3 * th + S.t * 2.3 + seed) + 0.05 * Math.sin(5 * th - S.t * 3.1 + seed * 2) + 0.025 * Math.sin(7 * th + S.t * 1.7));
      const rr = R * (1 + wob);
      const x = o.x + Math.cos(th) * rr;
      const y = o.y + Math.sin(th) * rr;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
    const glass = ctx.createRadialGradient(o.x - R * 0.35, o.y - R * 0.4, R * 0.05, o.x, o.y, R * 1.05);
    glass.addColorStop(0, `rgba(${brand},${0.28 + 0.5 * amt})`);
    glass.addColorStop(0.55, `rgba(${brand},${0.08 + 0.45 * amt})`);
    glass.addColorStop(1, `rgba(6,8,8,${0.9 - 0.3 * amt})`);
    ctx.fillStyle = "rgba(10,13,13,0.92)";
    ctx.fill();
    ctx.fillStyle = glass;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(255,255,255,${0.16 + 0.34 * amt})`;
    ctx.stroke();

    // liquid highlights: a specular streak on top and a caustic glow underneath
    if (amt > 0.01) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = `rgba(255,255,255,${0.42 * amt})`;
      ctx.beginPath();
      ctx.ellipse(o.x - R * 0.28, o.y - R * 0.5, R * 0.48, R * 0.2, -0.45, 0, Math.PI * 2);
      ctx.fill();
      const caustic = ctx.createRadialGradient(o.x + R * 0.1, o.y + R * 0.75, 0, o.x + R * 0.1, o.y + R * 0.75, R * 0.8);
      caustic.addColorStop(0, `rgba(255,255,255,${0.3 * amt})`);
      caustic.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = caustic;
      ctx.fillRect(o.x - R * 2, o.y - R * 2, R * 4, R * 4);
      ctx.restore();
    }

    const p = pathOf(o.key);
    if (p) {
      const sz = R * 1.05;
      const box = (LOGO[o.key] && LOGO[o.key].box) || 24;
      ctx.save();
      ctx.translate(o.x - sz / 2, o.y - sz / 2);
      ctx.scale(sz / box, sz / box);
      ctx.fillStyle = "rgba(244,248,246,0.95)";
      ctx.fill(p);
      ctx.restore();
    }
    ctx.restore();

    logoHits.push({ id, x: o.x, y: o.y, r: R + 4, z: o.z, front });
  }

  // the Ethereum crystal, slowly turning; it lives inside the eye
  function drawEthGlyph(x, y, sz, glow) {
    const p = pathOf("ETH");
    if (!p) return;
    const spin = Math.cos(S.t * 0.55);
    const sx = Math.max(0.12, Math.abs(spin));
    const face = ctx.createLinearGradient(0, 0, 24, 24);
    face.addColorStop(0, spin >= 0 ? "#f1f3fb" : "#9aa2c0");
    face.addColorStop(1, spin >= 0 ? "#8a92b2" : "#3d4358");
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sx, 1);
    ctx.translate(-sz / 2, -sz / 2);
    ctx.scale(sz / 24, sz / 24);
    ctx.shadowColor = `rgba(170,180,225,${Math.min(0.9, glow)})`;
    ctx.shadowBlur = sz * 0.22;
    ctx.fillStyle = face;
    ctx.fill(p);
    ctx.shadowBlur = 0;
    ctx.lineWidth = 0.15;
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.stroke(p);
    ctx.restore();
  }

  let ledgerPos = { x: -99, y: -99 };
  let ringPts = [];
  function draw(dt) {
    const g = geo();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    placeTags(g);
    if (S.diving) {
      // the dive: only the eye, growing to fill the view
      drawCore(g);
      return;
    }
    drawPlatform(g);
    drawProjection(g);
    drawConduits(g);
    ringPts = [];
    RINGS.forEach((r, i) => ringPts.push(drawRing(r, g, false, i)));
    const lb = drawLedger(g, false);
    const logos = logoPositions(g).sort((a, b) => a.z - b.z);
    logoHits = [];
    logos.filter((o) => o.z < 0).forEach((o) => drawLogo(o, false));
    drawCore(g);
    RINGS.forEach((r, i) => drawRing(r, g, true, i));
    const lf = drawLedger(g, true);
    ledgerPos = lf.z >= 0 ? lf : lb;
    logos.filter((o) => o.z >= 0).forEach((o) => drawLogo(o, true));
    RINGS.forEach((r) => ringLabel(r, g));
  }

  // ---------- loop ----------
  let last = performance.now();
  function frame(now) {
    S.started = true;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const tscale = S.paused ? 0 : 1;
    S.t += dt * tscale;
    S.energy += ((S.awake ? 1 : 0) - S.energy) * Math.min(1, dt * 1.6);
    const ease = Math.min(1, dt * (S.diving ? 2.6 : 4));
    if (!S.inspecting && !S.drag) {
      S.tYaw = 0.42 + Math.sin(S.t * 0.08) * 0.1;
    }
    S.yaw += (S.tYaw - S.yaw) * ease;
    S.pitch += (S.tPitch - S.pitch) * ease;
    S.zoom += (S.tZoom - S.zoom) * ease;
    S.look.x += (S.look.tx - S.look.x) * Math.min(1, dt * 5);
    S.look.y += (S.look.ty - S.look.y) * Math.min(1, dt * 5);
    beads.forEach((b, i) => {
      b.a += dt * tscale * (0.32 + i * 0.08) * (1 + S.energy * 1.4) * (i % 2 ? -1 : 1);
    });
    S.kickGlow = Math.max(0, (S.kickGlow || 0) - dt * 1.2);
    for (const o of [...CHAINS, ...STOCK_ORBIT]) {
      const id = "logo:" + o.key;
      hoverAmt[id] = (hoverAmt[id] || 0) + ((S.hover === id ? 1 : 0) - (hoverAmt[id] || 0)) * Math.min(1, dt * 7);
    }
    beads.forEach(() => {
    });
    draw(dt * tscale);
    requestAnimationFrame(frame);
  }

  function resize() {
    const r = stage.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    // resizing wipes the canvas after this frame was drawn; repaint now so the stage never flashes blank
    if (S.started && W > 0 && H > 0) draw(0);
  }

  // ---------- interaction ----------
  function hitTest(mx, my) {
    const g = geo();
    let lh = null;
    for (const h of logoHits) {
      if (Math.hypot(mx - h.x, my - h.y) < h.r && (!lh || (h.front && !lh.front) || (h.front === lh.front && h.z > lh.z))) lh = h;
    }
    if (lh) return lh.id;
    if (Math.hypot(mx - g.cx, my - g.cy) < coreRadius(g)) return "core";
    if (Math.hypot(mx - ledgerPos.x, my - ledgerPos.y) < 14) return "ledger";
    let best = null;
    let bestD = 11;
    ringPts.forEach((pts, i) => {
      for (let k = 0; k < pts.length; k += 2) {
        const d = Math.hypot(pts[k].x - mx, pts[k].y - my) - (pts[k].z >= 0 ? 3 : 0);
        if (d < bestD) {
          bestD = d;
          best = RINGS[i].id;
        }
      }
    });
    if (best) return best;
    for (const c of conduits) {
      for (let i = 1; i < c.pts.length; i++) {
        const [ax, ay] = c.pts[i - 1];
        const [bx, by] = c.pts[i];
        const L = Math.hypot(bx - ax, by - ay) || 1;
        const t = Math.max(0, Math.min(1, ((mx - ax) * (bx - ax) + (my - ay) * (by - ay)) / (L * L)));
        if (Math.hypot(mx - (ax + (bx - ax) * t), my - (ay + (by - ay) * t)) < 8) return c.id;
      }
    }
    return null;
  }
  const local = (e) => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  canvas.addEventListener("pointermove", (e) => {
    const m = local(e);
    const g = geo();
    S.look.tx = Math.max(-1, Math.min(1, (m.x - g.cx) / (W * 0.45)));
    S.look.ty = Math.max(-1, Math.min(1, (m.y - g.cy) / (H * 0.45)));
    if (S.drag) {
      S.tYaw = S.drag.yaw + (m.x - S.drag.x) * 0.008;
      S.tPitch = Math.max(-1.3, Math.min(1.1, S.drag.pitch + (m.y - S.drag.y) * 0.006));
      hideTip();
      return;
    }
    const hit = S.diving ? null : hitTest(m.x, m.y);
    S.hover = hit;
    canvas.style.cursor = hit ? "pointer" : S.inspecting ? "grab" : "";
    if (hit) showTip(hit, m.x, m.y);
    else hideTip();
  });
  canvas.addEventListener("pointerleave", () => {
    S.hover = null;
    S.look.tx = -0.35;
    S.look.ty = -0.15;
    hideTip();
  });
  canvas.addEventListener("pointerdown", (e) => {
    const m = local(e);
    if (S.inspecting && !hitTest(m.x, m.y)) {
      S.drag = { x: m.x, y: m.y, yaw: S.tYaw, pitch: S.tPitch };
      canvas.setPointerCapture(e.pointerId);
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    const m = local(e);
    if (S.drag) {
      const moved = Math.hypot(m.x - S.drag.x, m.y - S.drag.y) > 4;
      S.drag = null;
      if (moved) return;
    }
    const hit = hitTest(m.x, m.y);
    if (hit && hit.startsWith("logo:")) {
      const o = STOCK_ORBIT.find((x) => "logo:" + x.key === hit);
      if (o) goPage("/inspect#" + o.ticker);
      const c = CHAINS.find((x) => "logo:" + x.key === hit);
      if (c) window.open(c.url, "_blank", "noopener,noreferrer");
      return;
    }
    if (hit && ROUTES[hit]) go(ROUTES[hit]);
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (!S.inspecting) return;
      e.preventDefault();
      S.tZoom = Math.max(0.75, Math.min(2.2, S.tZoom - e.deltaY * 0.0012));
    },
    { passive: false },
  );

  // ---------- follow the scene's own controls ----------
  const VIEWS = {
    form: { yaw: 0.42, pitch: -0.34, zoom: 1 },
    optics: { yaw: 0.05, pitch: -0.08, zoom: 1.85 },
    mechanics: { yaw: 0.6, pitch: -1.05, zoom: 1.12 },
  };
  function setView(name) {
    const v = VIEWS[name] || VIEWS.form;
    S.tYaw = v.yaw;
    S.tPitch = v.pitch;
    S.tZoom = v.zoom;
  }
  document.querySelectorAll(".finish").forEach((b) => b.addEventListener("click", () => setView(b.dataset.detail)));
  const zi = document.getElementById("zoom-in");
  const zo = document.getElementById("zoom-out");
  const rv = document.getElementById("reset-view");
  zi && zi.addEventListener("click", () => (S.tZoom = Math.min(2.2, S.tZoom + 0.18)));
  zo && zo.addEventListener("click", () => (S.tZoom = Math.max(0.75, S.tZoom - 0.18)));
  rv && rv.addEventListener("click", () => setView("form"));

  const sync = () => {
    const was = S.awake;
    S.awake = exp.classList.contains("awakened");
    if (S.awake && !was) S.kickGlow = 1;
    const insp = exp.classList.contains("inspecting");
    if (insp !== S.inspecting) {
      S.inspecting = insp;
      setView("form");
    }
    const motion = document.getElementById("motion");
    S.paused = reduced || (motion && motion.getAttribute("aria-pressed") === "true");
  };
  new MutationObserver(sync).observe(exp, { attributes: true, attributeFilter: ["class"] });
  const motionBtn = document.getElementById("motion");
  motionBtn && new MutationObserver(sync).observe(motionBtn, { attributes: true, attributeFilter: ["aria-pressed"] });
  sync();

  // the scene script still speaks of the sentinel; translate its live labels
  const WORDS = [
    ["Awaken N—01", "Start the engine"],
    ["N—01 is awake", "Engine running"],
    ["SENTINEL ONLINE", "ENGINE ONLINE"],
    ["N—01 / AWAKE", "ENGINE / RUNNING"],
    ["MOVE YOUR CURSOR", "HOVER A PART"],
    ["Awake", "Running"],
    ["Touch to awaken", "Touch to start"],
    ["Tap to return to standby", "Tap to stop"],
  ];
  const translate = (el) => {
    if (!el) return;
    let html = el.innerHTML;
    let changed = false;
    for (const [a, b] of WORDS) {
      if (html.includes(a) && !html.includes(b)) {
        html = html.split(a).join(b);
        changed = true;
      }
    }
    if (changed) el.innerHTML = html;
  };
  ["awaken-label", "model-state", "stage-hint", "sentinel-state", "sentinel-caption"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    translate(el);
    new MutationObserver(() => translate(el)).observe(el, { childList: true, characterData: true, subtree: true });
  });

  window.addEventListener("storage", (e) => {
    if (e.key === "nightshift.paper.v1" && tipKey === "guardian") {
      tipKey = null;
    }
  });

  window.addEventListener(
    "click",
    (e) => {
      const b = e.target.closest && e.target.closest("#inspect, #nav-inspect, #stocks-btn");
      if (!b) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (b.id === "stocks-btn") go("#stocks");
      else diveInto("/inspect");
    },
    true,
  );

  // the soundtrack is always on and lives in the page: forward the first interaction here so it can start.
  // Opened on its own (not embedded), the scene starts its own soundtrack instead.
  const startAudio = () => {
    if (window.top !== window) window.parent.postMessage({ type: "ns-audio-start" }, window.location.origin);
    else {
      const s = document.getElementById("sound");
      if (s && s.getAttribute("aria-pressed") !== "true") s.click();
    }
  };
  ["pointerdown", "keydown", "touchstart"].forEach((ev) => window.addEventListener(ev, startAudio, { capture: true, once: true }));

  new ResizeObserver(resize).observe(stage);
  resize();
  load();
  setInterval(load, 60000);
  loadStocks();
  setInterval(loadStocks, 120000);
  requestAnimationFrame(frame);
})();
