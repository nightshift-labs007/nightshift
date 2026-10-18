"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPublicClient, formatEther, type Address, type PublicClient } from "viem";
import { ABI, DEPLOYMENT, chainOf, chainTransport, isDeployed } from "@/lib/chain";
import type { Leaderboard } from "@/lib/leaderboard";
import { EXPLAIN, HELP, PAGE_HREF, PAGE_NAME, SUGGESTIONS, normalize, parse, type Intent } from "@/lib/nyx";
import type { OracleSnapshot, Quote } from "@/lib/oracle";
import type { StockBoard } from "@/lib/stocks";
import { healthFactor, useAccount } from "@/lib/paper";
import { useWallet } from "@/lib/wallet";

/**
 * Nyx: Nightshift's voice assistant. With Groq switched on (GROQ_API_KEY), it records your voice and transcribes it
 * with Whisper, and answers open questions with an AI model grounded in Nightshift's facts and live prices. Without
 * it, it uses the browser's speech recognition and the built-in answers in lib/nyx.ts. Live data (prices, your loan,
 * points) and actions (going to a page) are always handled locally and instantly. It never moves money.
 */
// intents answered from Nightshift's own data or carried out directly, never sent to the AI
const LOCAL = new Set<Intent["kind"]>(["price", "stock", "movers", "market", "confidence", "accuracy", "loan", "points", "leaders", "go", "money", "wallet", "tour", "alerts", "stop", "time", "thanks"]);
const ACTIONS = new Set<Intent["kind"]>(["go", "money", "wallet", "tour", "alerts", "stop"]);
// questions that need reasoning even when they mention a token ("why is gold down?")
const OPEN_QUESTION = /^(why|how come|should|would|could|what if|compare|tell me more|is it (a )?good|explain why|what do you think)\b/;
// Whisper sometimes "hears" these in near-silence
const PHANTOM = /^(thank you|thanks for watching|you|bye|okay)[.!]?$/i;
const canRecord = () => typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

function micError(err: unknown): string {
  const name = (err as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access is blocked. Click the lock or microphone icon in the address bar, allow the microphone for this site, then tap the orb again. Or just type to me.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "I can't find a microphone on this device. Plug one in, or type to me instead.";
  if (name === "NotReadableError") return "Another app is using your microphone. Close it, then tap the orb again.";
  return "I couldn't open the microphone. Try tapping the orb again, or type to me.";
}
type Msg = { who: "you" | "nyx"; text: string };
type Loan = { token: string; hf: number; debt: number; guardian: number | null; source: "wallet" | "paper" };

type SR = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
const getSR = (): (new () => SR) | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

const usd = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (x: number) => `${Math.abs(x).toFixed(2)} percent`;
const move = (x: number) => (Math.abs(x) < 0.005 ? "flat" : `${x > 0 ? "up" : "down"} ${pct(x)}`);
const spokenToken = (t: string) => ({ SPY: "SPY", QQQ: "Q Q Q", GLD: "gold", IBIT: "the bitcoin ETF" })[t] ?? t;
const short = (a: string) => `${a.slice(2, 6)}`;

/** Prefer a calm English voice; Nyx is the goddess of night, so a female voice if one is available. */
function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === "undefined") return null;
  const vs = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
  const prefer = [/google uk english female/i, /sonia|libby|maisie/i, /serena|kate|samantha|karen|moira/i, /aria|jenny|zira/i, /female/i, /en-gb/i];
  for (const re of prefer) {
    const v = vs.find((x) => re.test(x.name) || re.test(x.lang));
    if (v) return v;
  }
  return vs[0] ?? null;
}

function useOnchainClient() {
  const ref = useRef<PublicClient | null>(null);
  if (!ref.current && isDeployed) ref.current = createPublicClient({ chain: chainOf(), transport: chainTransport() }) as PublicClient;
  return ref.current;
}

export function Nyx() {
  const router = useRouter();
  const path = usePathname();
  const w = useWallet();
  const paper = useAccount();
  const pub = useOnchainClient();

  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [voiceOn, setVoiceOn] = useState(true);
  const [alertsOn, setAlertsOn] = useState(false);
  const [supported, setSupported] = useState(false);
  const [ai, setAi] = useState(false);
  const [thinking, setThinking] = useState(false);
  const recRef = useRef<SR | null>(null);
  const recorderRef = useRef<{ stop: () => void } | null>(null);
  const orbRef = useRef<HTMLButtonElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<(t: string) => void>(() => {});
  const msgsRef = useRef<Msg[]>([]);
  msgsRef.current = msgs;

  useEffect(() => {
    setSupported(!!getSR() || canRecord());
    fetch("/api/nyx")
      .then((r) => r.json())
      .then((j: { ai?: boolean }) => setAi(!!j.ai))
      .catch(() => {});
    setVoiceOn(store.get("ns-nyx-voice") !== "0");
    setAlertsOn(store.get("ns-nyx-alerts") === "1");
    if (typeof speechSynthesis !== "undefined") speechSynthesis.getVoices(); // warm the voice list
  }, []);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }); }, [msgs, interim]);
  // dip the site soundtrack while Nyx listens or speaks
  useEffect(() => { window.dispatchEvent(new CustomEvent("ns:audio-duck", { detail: listening || speaking })); }, [listening, speaking]);

  const say = useCallback(
    (reply: string) => {
      setMsgs((m) => [...m, { who: "nyx" as const, text: reply }].slice(-12));
      if (!voiceOn || typeof speechSynthesis === "undefined") return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(reply);
      const v = pickVoice();
      if (v) u.voice = v;
      u.rate = 1;
      u.pitch = 0.95;
      u.onstart = () => setSpeaking(true);
      u.onend = u.onerror = () => setSpeaking(false);
      speechSynthesis.speak(u);
    },
    [voiceOn],
  );

  // ---------------------------------------------------------------- data
  const getJson = async <T,>(url: string): Promise<T | null> => {
    const r = await fetch(url, { cache: "no-store" }).catch(() => null);
    return ((await r?.json().catch(() => null)) as T | null) ?? null;
  };
  const getSnap = () => getJson<OracleSnapshot>("/api/oracle");

  const getLoans = useCallback(
    async (snap: OracleSnapshot | null): Promise<Loan[]> => {
      const out: Loan[] = [];
      if (w.account && pub && isDeployed) {
        for (const [sym, t] of Object.entries(DEPLOYMENT.tokens ?? {})) {
          try {
            const [, d] = (await pub.readContract({ address: DEPLOYMENT.contracts.vault, abi: ABI.vault as never, functionName: "positions" as never, args: [w.account, t.address] as never })) as [bigint, bigint];
            if (d === 0n) continue;
            const hf = Number(formatEther((await pub.readContract({ address: DEPLOYMENT.contracts.vault, abi: ABI.vault as never, functionName: "healthFactor" as never, args: [w.account, t.address] as never })) as bigint));
            const [mode, trigger] = (await pub.readContract({ address: DEPLOYMENT.contracts.vault, abi: ABI.vault as never, functionName: "rules" as never, args: [w.account, t.address as Address] as never })) as [number, bigint, bigint];
            out.push({ token: sym, hf, debt: Number(formatEther(d)), guardian: mode === 2 ? Number(formatEther(trigger)) : null, source: "wallet" });
          } catch {
            /* stale price or RPC hiccup: skip this market */
          }
        }
      }
      for (const p of paper.positions.filter((x) => x.status === "open" && x.debt > 0)) {
        const q = snap?.quotes.find((x) => x.token === p.token);
        if (!q) continue;
        out.push({ token: p.token, hf: healthFactor(p.units, q.fairValue, p.debt, p.lltv), debt: p.debt, guardian: p.guardian.mode === "auto" ? p.guardian.trigger : null, source: "paper" });
      }
      return out;
    },
    [w.account, pub, paper.positions],
  );

  // ---------------------------------------------------------------- answers
  const answer = useCallback(
    async (intent: Intent): Promise<string> => {
      const quoteLine = (q: Quote) => `${spokenToken(q.token)} is worth ${usd(q.fairValue)}, ${move(q.driftPct)} since the last close, with ${q.confidence} percent confidence.`;
      switch (intent.kind) {
        case "price": {
          const snap = await getSnap();
          if (!snap?.quotes?.length) return "I can't reach the price engine right now. Try again in a moment.";
          if (intent.token) {
            const q = snap.quotes.find((x) => x.token === intent.token);
            if (!q) return `I don't price ${intent.token} yet.`;
            const event = q.flags?.some((f) => f.startsWith("event mode")) ? " Heads up: it's moving sharply while the market is closed, so I've lowered my confidence." : "";
            const sim = q.source !== "live" ? " That's simulated data, because live feeds are unavailable." : "";
            return `${quoteLine(q)}${event}${sim}`;
          }
          return `${snap.market.open ? "The market is open." : "Wall Street is closed, so here are my overnight prices."} ${snap.quotes.map((q) => `${spokenToken(q.token)}, ${usd(q.fairValue)}, ${move(q.driftPct)}.`).join(" ")}`;
        }
        case "stock": {
          const b = await getJson<StockBoard>("/api/stocks");
          if (!b?.stocks?.length) return "I can't reach the stock board right now. It's on the home page under Top stocks.";
          const lines = intent.tickers.map((t) => {
            const q = b.stocks.find((s) => s.ticker === t);
            if (!q) return `I don't have ${t} right now.`;
            if (q.marketOpen) return `${q.name} is trading at ${usd(q.price)}, ${move(q.dayChangePct)} today.`;
            const ah = q.extended ? `, and its latest after-hours trade was ${usd(q.extended.price)}` : "";
            return `${q.name} last closed at ${usd(q.lastClose)}. My overnight fair value is ${usd(q.fairValue)}, ${move(q.driftPct)}${ah}.`;
          });
          return lines.join(" ");
        }
        case "movers": {
          const snap = await getSnap();
          if (!snap?.quotes?.length) return "I can't reach the price engine right now.";
          const q = [...snap.quotes].sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct))[0];
          return `The biggest mover is ${spokenToken(q.token)}, ${move(q.driftPct)} since the close, at ${usd(q.fairValue)}.`;
        }
        case "market": {
          const snap = await getSnap();
          if (!snap) return "I can't reach the market clock right now.";
          const time = snap.market.etTime.replace(/^\w+ /, "").replace(/ ET$/, "");
          return snap.market.open
            ? `The New York market is open. It's ${time} Eastern, and prices are tracking live trading.`
            : `Wall Street is closed. It's ${time} Eastern. This is my shift: I'm pricing overnight from futures and world markets.`;
        }
        case "confidence": {
          const snap = await getSnap();
          if (!snap?.quotes?.length) return "I can't reach the price engine right now.";
          const qs = intent.token ? snap.quotes.filter((q) => q.token === intent.token) : snap.quotes;
          return `${qs.map((q) => `${q.confidence} percent on ${spokenToken(q.token)}`).join(", ")}. Confidence falls the longer markets stay closed and when my signals disagree.`;
        }
        case "accuracy": {
          const r = await getJson<{ reports: { token: string; rows: unknown[]; avgNightshiftBps: number; avgStaleBps: number; wins: number }[] }>("/api/shift-report");
          const spy = r?.reports?.find((x) => x.token === "SPY") ?? r?.reports?.[0];
          if (!spy) return "I can't load my track record right now. It's on the Oracle page.";
          const wins = r!.reports.reduce((s, x) => s + x.wins, 0), total = r!.reports.reduce((s, x) => s + x.rows.length, 0);
          return `Over the last ${spy.rows.length} market opens, my predicted open for SPY missed by ${(spy.avgNightshiftBps / 100).toFixed(2)} percent on average, against ${(spy.avgStaleBps / 100).toFixed(2)} percent for a frozen closing price. Across all four ETFs I was closer on ${wins} of ${total} opens. Every morning's call is also locked on Algorand before the bell.`;
        }
        case "loan": {
          const loans = await getLoans(await getSnap());
          if (!loans.length)
            return w.account
              ? "You don't have an open loan. Open the App to borrow against your demo tokens."
              : "You don't have a wallet connected, and your paper account has no open loans. Connect a wallet, or try borrowing in the App without one.";
          return loans
            .map((l) => {
              const state = l.hf < 1 ? "below 1, so it can be liquidated. Add collateral or repay now." : l.hf < 1.15 ? "close to the edge. Consider adding collateral." : l.hf < 1.4 ? "safe, but keep an eye on it." : "comfortably safe.";
              const g = l.guardian ? ` The Guardian steps in at ${l.guardian.toFixed(2)}.` : " The Guardian is off for this loan.";
              return `Your ${l.source === "paper" ? "paper " : ""}${spokenToken(l.token)} loan has a health factor of ${l.hf > 50 ? "over 50" : l.hf.toFixed(2)}, which is ${state}${g}`;
            })
            .join(" ");
        }
        case "points": {
          if (!w.account) return "Connect a wallet and I'll tell you your points and rank.";
          const b = await getJson<Leaderboard>("/api/leaderboard");
          const me = b?.rows?.find((r) => r.address === w.account!.toLowerCase());
          if (!me) return "You're not on the leaderboard yet. Join from your profile with a free signature for your first 10 points, then deposit and borrow in the App to earn more.";
          return `You have ${me.points} points and you're number ${me.rank} of ${b!.totals.wallets}.${me.guardian ? "" : " Switching on the Guardian is worth 25 more."}`;
        }
        case "leaders": {
          const b = await getJson<Leaderboard>("/api/leaderboard");
          if (!b?.rows?.length) return "The leaderboard is empty so far. You could be first.";
          return `Top of the board: ${b.rows.slice(0, 3).map((r) => `number ${r.rank}, ${r.name ?? `wallet ${short(r.address)}`}, with ${r.points} points`).join("; ")}.`;
        }
        case "go":
          router.push(PAGE_HREF[intent.page]);
          return `Opening ${PAGE_NAME[intent.page]}.`;
        case "explain":
          return EXPLAIN[intent.topic];
        case "money":
          if (path !== "/app") router.push("/app");
          return "For your safety, I never move money by voice. I've opened the App: choose the amount there, and confirm in your wallet.";
        case "wallet":
          window.dispatchEvent(new Event("ns:wallet-open"));
          return w.account ? "Your wallet is already connected." : "Pick your wallet in the window that just opened.";
        case "tour":
          setOpen(false);
          window.dispatchEvent(new Event("ns:guide-open"));
          return "Here's the quick tour.";
        case "alerts":
          setAlertsOn(intent.on);
          store.set("ns-nyx-alerts", intent.on ? "1" : "0");
          return intent.on
            ? "Alerts are on. While this page is open, I'll speak up if one of your loans gets close to its limit, or if a market moves sharply overnight."
            : "Alerts are off.";
        case "help":
          return HELP;
        case "who":
          return "I'm Nyx, named after the Greek goddess of night. I work the night shift: I watch the markets while Wall Street sleeps, and I can tell you about prices, your loan and how Nightshift works.";
        case "greet": {
          const h = new Date().getHours();
          return `${h < 5 || h >= 18 ? "Good evening" : h < 12 ? "Good morning" : "Good afternoon"}. I'm Nyx. Ask me what anything's worth, how your loan is doing, or how Nightshift works.`;
        }
        case "thanks":
          return "Any time.";
        case "time":
          return `It's ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} where you are, and ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} in New York.`;
        case "stop":
          if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
          return "";
        default:
          return `I didn't catch that. You can ask things like: ${SUGGESTIONS.slice(0, 3).map((s) => s.replace(/\?$/, "").toLowerCase()).join("; ")}.`;
      }
    },
    [getLoans, path, router, w.account],
  );

  /** Open questions go to the AI, with a short note about the user's own loans and points when they ask about "my…". */
  const askAI = useCallback(
    async (question: string): Promise<string | null> => {
      let me: string | undefined;
      if (/\b(my|me|i|am i)\b/.test(normalize(question)) && (w.account || paper.positions.length)) {
        const snap = await getSnap();
        const loans = await getLoans(snap).catch(() => [] as Loan[]);
        const board = w.account ? await getJson<Leaderboard>("/api/leaderboard") : null;
        const row = board?.rows.find((r) => r.address === w.account?.toLowerCase());
        me = [
          w.account ? `Wallet connected.` : "No wallet connected (paper account only).",
          loans.length ? loans.map((l) => `${l.source} ${l.token} loan: health factor ${l.hf.toFixed(2)}, debt ${l.debt.toFixed(2)} dUSDG, Guardian ${l.guardian ? `on at ${l.guardian.toFixed(2)}` : "off"}.`).join(" ") : "No open loans.",
          row ? `Leaderboard: ${row.points} points, rank ${row.rank} of ${board!.totals.wallets}.` : w.account ? "Not on the leaderboard yet." : "",
        ].join(" ");
      }
      const history = msgsRef.current.slice(-7, -1); // the turns before this question
      const res = await fetch("/api/nyx/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, history, me }) }).catch(() => null);
      const j = (await res?.json().catch(() => null)) as { answer?: string; error?: string } | null;
      if (res?.ok && j?.answer) return j.answer;
      if (res?.status === 429 && j?.error) return j.error;
      return null; // fall back to the built-in answer
    },
    [getLoans, paper.positions.length, w.account],
  );

  const handle = useCallback(
    async (raw: string) => {
      const t = raw.trim();
      if (!t) return;
      setMsgs((m) => [...m, { who: "you" as const, text: t }].slice(-12));
      const intent = parse(t);
      const open = OPEN_QUESTION.test(normalize(t).replace(/^(hey |hi |ok |okay )?(nyx|nix|nicks|knicks)[, ]*/, ""));
      let reply: string | null = null;
      if (ai && !ACTIONS.has(intent.kind) && (!LOCAL.has(intent.kind) || open)) {
        setThinking(true);
        reply = await askAI(t).catch(() => null);
        setThinking(false);
      }
      if (reply === null) reply = await answer(intent).catch(() => "Something went wrong on my side. Please try again.");
      if (reply) say(reply);
    },
    [ai, answer, askAI, say],
  );
  handleRef.current = handle;

  // ---------------------------------------------------------------- listening
  const stopListening = useCallback(() => {
    if (recorderRef.current) recorderRef.current.stop();
    else recRef.current?.stop();
  }, []);

  /**
   * Whisper path: record the microphone, end the clip after ~1.6 s of quiet once speech has started (or on a tap /
   * Space release), then transcribe it on the server. Works in every browser with a microphone.
   */
  const startRecording = useCallback(async () => {
    setOpen(true);
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    setListening(true);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      setListening(false);
      return say(micError(err));
    }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported?.(m)) ?? "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

    // a simple voice-activity check on the microphone level
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const t0 = performance.now();
    let spoke = false, lastVoice = t0, floor = 0.008, done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(timer);
      if (rec.state !== "inactive") rec.stop();
    };
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      if (now - t0 < 350) floor = Math.min(0.04, Math.max(floor, rms)); // room noise, measured before you speak
      if (rms > Math.max(0.015, floor * 2.5)) { spoke = true; lastVoice = now; }
      orbRef.current?.style.setProperty("--lvl", Math.min(1, rms * 9).toFixed(3));
      if ((spoke && now - lastVoice > 1600) || (!spoke && now - t0 > 8000) || now - t0 > 30000) finish();
    }, 80);

    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      recorderRef.current = null;
      orbRef.current?.style.setProperty("--lvl", "0");
      setListening(false);
      if (!spoke) return say("I didn't hear anything. Tap the orb, wait for it to turn orange, then speak.");
      setThinking(true);
      setInterim("Listening back…");
      try {
        const form = new FormData();
        form.append("audio", new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" }), "clip");
        const res = await fetch("/api/nyx/transcribe", { method: "POST", body: form });
        const j = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
        setInterim("");
        setThinking(false);
        if (!res.ok) return say(j.error ?? "I couldn't make that out. Please try again.");
        const heard = (j.text ?? "").trim();
        if (!heard || PHANTOM.test(heard)) return say("I couldn't make out any words. Try again, a little closer to the microphone.");
        handleRef.current(heard);
      } catch {
        setInterim("");
        setThinking(false);
        say("I couldn't reach my hearing service. Check your connection and try again.");
      }
    };
    recorderRef.current = { stop: finish };
    rec.start(250);
  }, [say]);

  /** Browser speech-recognition path, used when the AI isn't switched on or recording isn't available. */
  const startBrowserSpeech = useCallback(async () => {
    const SR = getSR();
    setOpen(true);
    if (!SR) return say("This browser can't do speech recognition. Chrome, Edge or Safari can; here you can type to me instead.");
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    recRef.current?.abort();
    setListening(true); // show "Listening…" straight away, while the microphone opens

    // ask for the microphone first, so a block or a missing mic gets a clear message instead of silence
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch (err) {
        setListening(false);
        return say(micError(err));
      }
    }

    const rec = new SR();
    rec.lang = navigator.language?.startsWith("en") ? navigator.language : "en-US";
    // keep listening through short pauses: the sentence is sent after ~2 s of quiet, or when the orb is tapped
    // again / Space is released (both call stop, and onend sends what was heard)
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    let heard = false, failed = false, sentence = "";
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const SILENCE_MS = 2000, FIRST_WORD_MS = 8000, MAX_MS = 30000;
    const stopSoon = (ms: number) => { clearTimeout(quiet); quiet = setTimeout(() => rec.stop(), ms); };
    const hardStop = setTimeout(() => rec.stop(), MAX_MS);
    stopSoon(FIRST_WORD_MS);
    rec.onresult = (e) => {
      let finalText = "", interimText = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      sentence = `${finalText} ${interimText}`.replace(/\s+/g, " ").trim();
      if (sentence) heard = true;
      setInterim(sentence);
      stopSoon(SILENCE_MS);
    };
    rec.onerror = (e) => {
      failed = true;
      const msg: Record<string, string> = {
        "not-allowed": "Microphone access is blocked. Allow the microphone for this site in the address bar, then tap the orb again.",
        "service-not-allowed": "This browser won't let me use its speech service. Try Chrome or Edge, or type to me instead.",
        "audio-capture": "I can't find a working microphone. Check it's plugged in and selected, or type to me.",
        "network": "I can't reach the browser's speech service. Check your connection; in Brave, speech input isn't supported, so use Chrome or Edge, or type to me.",
        "no-speech": "I didn't hear anything. Tap the orb, wait for it to turn orange, then speak.",
        "language-not-supported": "Your browser's speech service doesn't support this language. Type to me instead.",
      };
      if (msg[e.error]) say(msg[e.error]);
      else if (e.error !== "aborted") say(`Voice input stopped (${e.error}). Tap the orb to try again, or type to me.`);
    };
    rec.onend = () => {
      clearTimeout(quiet);
      clearTimeout(hardStop);
      setListening(false);
      setInterim("");
      if (sentence) handleRef.current(sentence);
      else if (!heard && !failed) say("I didn't catch anything. Tap the orb, wait for it to turn orange, then speak.");
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      setListening(false);
      say("Voice input couldn't start. Tap the orb again in a moment.");
    }
  }, [say]);

  const startListening = useCallback(() => (ai && canRecord() ? startRecording() : startBrowserSpeech()), [ai, startRecording, startBrowserSpeech]);

  // hold Space to talk, when not typing or on a control
  useEffect(() => {
    const editable = (el: Element | null) => !!el && (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName) || (el as HTMLElement).isContentEditable);
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || editable(document.activeElement) || !getSR()) return;
      e.preventDefault();
      startListening();
    };
    const up = (e: KeyboardEvent) => { if (e.code === "Space" && (recRef.current || recorderRef.current)) stopListening(); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [startListening, stopListening]);

  // ---------------------------------------------------------------- alerts (opt-in, while the page is open)
  const alerted = useRef(new Map<string, number>());
  useEffect(() => {
    if (!alertsOn) return;
    let alive = true;
    const tick = async () => {
      const snap = await getSnap();
      if (!alive || !snap) return;
      for (const q of snap.quotes) {
        const flag = q.flags?.find((f) => f.startsWith("event mode"));
        const key = `event:${q.token}:${new Date().toDateString()}`;
        if (flag && !alerted.current.has(key)) {
          alerted.current.set(key, Date.now());
          setOpen(true);
          say(`Heads up: ${spokenToken(q.token)} is ${move(q.driftPct)} while the market is closed. I've lowered my confidence to ${q.confidence}.`);
        }
      }
      for (const l of await getLoans(snap)) {
        const line = l.guardian ? l.guardian + 0.05 : 1.25;
        const key = `loan:${l.source}:${l.token}`;
        const last = alerted.current.get(key);
        if (l.hf < line && (!last || Date.now() - last > 30 * 60_000)) {
          alerted.current.set(key, Date.now());
          setOpen(true);
          say(`Alert: your ${l.source === "paper" ? "paper " : ""}${spokenToken(l.token)} loan's health has fallen to ${l.hf.toFixed(2)}. ${l.guardian ? `The Guardian acts at ${l.guardian.toFixed(2)}.` : "The Guardian is off: consider adding collateral or repaying."}`);
        } else if (l.hf >= line + 0.1) alerted.current.delete(key);
      }
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [alertsOn, getLoans, say]);

  const toggleVoice = () => {
    const v = !voiceOn;
    setVoiceOn(v);
    store.set("ns-nyx-voice", v ? "1" : "0");
    if (!v && typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  };

  const greeted = useRef(false);
  const openPanel = () => {
    setOpen(true);
    if (!greeted.current && !msgs.length) {
      greeted.current = true;
      setMsgs([{ who: "nyx", text: supported ? `I'm Nyx. Tap the orb or hold Space and ask me anything${ai ? ", about Nightshift or the world" : " about Nightshift"}.` : "I'm Nyx. Voice input isn't supported in this browser, but you can type to me." }]);
    }
  };

  return (
    <>
      {open && (
        <div className="nyx-panel" role="dialog" aria-label="Nyx voice assistant">
          <header className="nyx-head">
            <div>
              <b>Nyx</b>
              <span className={`nyx-status ${listening ? "on" : ""}`}>{listening ? "Listening… tap the orb when done" : thinking ? "Thinking…" : speaking ? "Speaking…" : ai ? "Ready · AI on" : "Ready"}</span>
            </div>
            <div className="nyx-tools">
              <button className={`nyx-chip ${voiceOn ? "on" : ""}`} onClick={toggleVoice} aria-pressed={voiceOn} title="Spoken replies">Voice {voiceOn ? "on" : "off"}</button>
              <button className={`nyx-chip ${alertsOn ? "on" : ""}`} onClick={() => handle(alertsOn ? "turn off alerts" : "turn on alerts")} aria-pressed={alertsOn} title="Spoken alerts about your loans and big overnight moves">Alerts {alertsOn ? "on" : "off"}</button>
              <button className="nyx-x" onClick={() => { setOpen(false); recRef.current?.abort(); if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel(); }} aria-label="Close Nyx">×</button>
            </div>
          </header>
          <div className="nyx-log" ref={logRef} aria-live="polite">
            {msgs.map((m, i) => <p key={i} className={`nyx-msg ${m.who}`}>{m.text}</p>)}
            {interim && <p className="nyx-msg you interim">{interim}…</p>}
          </div>
          {msgs.length <= 1 && (
            <div className="nyx-suggest">
              {SUGGESTIONS.map((s) => <button key={s} onClick={() => handle(s)}>{s}</button>)}
            </div>
          )}
          <form className="nyx-input" onSubmit={(e) => { e.preventDefault(); handle(text); setText(""); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={supported ? "Ask Nyx, or hold Space to talk" : "Ask Nyx anything…"} aria-label="Ask Nyx" maxLength={200} />
            <button type="submit" disabled={!text.trim()} aria-label="Send">→</button>
          </form>
          <p className="nyx-foot">Nyx can't move money or give investment advice. {ai ? "Your voice and questions are processed by Groq." : `Voice is processed by your browser${supported ? " (some browsers send audio to their speech service)" : ""}.`}</p>
        </div>
      )}
      <button
        ref={orbRef}
        className={`nyx-orb ${listening ? "listening" : ""} ${speaking ? "speaking" : ""} ${thinking ? "thinking" : ""}`}
        onClick={() => {
          if (!open) openPanel();
          if (listening) stopListening();
          else if (supported) startListening();
        }}
        aria-label={listening ? "Stop listening" : "Talk to Nyx"}
        title="Talk to Nyx (or hold Space)"
      >
        <span className="nyx-core" aria-hidden="true" />
        <span className="nyx-ring" aria-hidden="true" />
        <span className="nyx-ring r2" aria-hidden="true" />
      </button>
    </>
  );
}

