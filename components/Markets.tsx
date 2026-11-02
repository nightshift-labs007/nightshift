"use client";

import { useEffect, useRef, useState } from "react";
import { MARKETS, READINESS_LABEL, useMarket, type Market, type MarketId } from "@/lib/markets";
import { Flag } from "./Flag";
import { useApi } from "./useApi";

type Counts = { enabled: boolean; counts: Record<MarketId, number> };

/** Three market cards; picking one saves the preference. Used in the welcome guide, the homepage and the profile. */
export function MarketChoice({ compact = false }: { compact?: boolean }) {
  const [market, choose] = useMarket();
  return (
    <div className={`market-choice ${compact ? "compact" : ""}`} role="radiogroup" aria-label="Choose your market">
      {MARKETS.map((m) => (
        <button key={m.id} role="radio" aria-checked={market?.id === m.id} className={`market-card ${market?.id === m.id ? "on" : ""}`} onClick={() => choose(m.id)}>
          <span className="market-flag"><Flag id={m.id} /></span>
          <b>{m.name}</b>
          {!compact && <span>{m.tagline}</span>}
        </button>
      ))}
    </div>
  );
}

/** Nav pill showing the current market, with a small menu to change it. */
export function MarketSwitch() {
  const [market, choose] = useMarket();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", off);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="market-switch" ref={box}>
      <button className="market-pill" onClick={() => setOpen((x) => !x)} aria-expanded={open} aria-haspopup="menu" title="Your market">
        <Flag id={market?.id ?? null} size={18} />
        <span className="market-pill-label">{market?.name ?? "Market"}</span>
        <span aria-hidden="true" className="market-caret">▾</span>
      </button>
      {open && (
        <div className="market-menu" role="menu">
          {MARKETS.map((m) => (
            <button
              key={m.id}
              role="menuitemradio"
              aria-checked={market?.id === m.id}
              className={market?.id === m.id ? "on" : ""}
              onClick={() => {
                choose(m.id);
                setOpen(false);
              }}
            >
              <Flag id={m.id} size={18} /> {m.name}
              <small>Lending: {READINESS_LABEL[m.features.lending].toLowerCase()}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const WL_TEXT = {
  en: {
    done: (m: string) => `You're on the ${m} waitlist. We'll only contact you when something in this market switches on.`,
    label: (m: string) => `Join the ${m} waitlist`,
    placeholder: "Email or Telegram @username",
    busy: "Joining…",
    join: "Join",
    fail: "Couldn't join right now. Try again in a minute.",
    fine: "Used only to tell you when this market opens. No spam, no promotions, never shared.",
  },
  hi: {
    done: () => "आप भारत की वेटलिस्ट में हैं। इस मार्केट में कुछ नया शुरू होने पर ही हम आपसे संपर्क करेंगे।",
    label: () => "भारत की वेटलिस्ट में जुड़ें",
    placeholder: "ईमेल या Telegram @username",
    busy: "जोड़ रहे हैं…",
    join: "जुड़ें",
    fail: "अभी जुड़ नहीं पाए। एक मिनट बाद फिर कोशिश करें।",
    fine: "सिर्फ़ यह बताने के लिए कि यह मार्केट कब खुलेगा। कोई स्पैम या प्रमोशन नहीं, किसी से साझा नहीं।",
  },
};

export function WaitlistForm({ market, onJoined, lang = "en" }: { market: Market; onJoined?: (counts: Counts["counts"] | null) => void; lang?: "en" | "hi" }) {
  const t = WL_TEXT[lang];
  const [contact, setContact] = useState("");
  const [state, setState] = useState<"" | "busy" | "done">("");
  const [error, setError] = useState("");
  useEffect(() => {
    setState("");
    setError("");
  }, [market.id]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    setError("");
    const res = await fetch("/api/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ market: market.id, contact }) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string; counts?: Counts["counts"] | null } | null;
    if (j?.ok) {
      setState("done");
      setContact("");
      onJoined?.(j.counts ?? null);
    } else {
      setState("");
      setError(lang === "en" ? (j?.error ?? t.fail) : t.fail);
    }
  }
  if (state === "done")
    return (
      <p className="waitlist-done" role="status">
        {t.done(market.name)}
      </p>
    );
  return (
    <form className="waitlist" onSubmit={submit}>
      <label className="field" htmlFor="wl-contact">
        {t.label(market.name)}
      </label>
      <div className="waitlist-row">
        <input id="wl-contact" type="text" inputMode="email" value={contact} onChange={(e) => setContact(e.target.value)} placeholder={t.placeholder} autoComplete="email" required maxLength={254} />
        <button className="btn primary" disabled={state === "busy"}>
          {state === "busy" ? t.busy : t.join}
        </button>
      </div>
      {error && <p className="waitlist-error">{error}</p>}
      <p className="waitlist-fine">{t.fine}</p>
    </form>
  );
}

/** Homepage block for the chosen market: what is on, what isn't yet, the legal note and its waitlist. */
export function MarketPanel() {
  const [market] = useMarket();
  const { data } = useApi<Counts>("/api/waitlist", 120_000);
  const [fresh, setFresh] = useState<Counts["counts"] | null>(null);
  if (!market)
    return (
      <div className="card panel market-panel">
        <h3>Where are you following from?</h3>
        <p className="muted">Pick a market. It decides which prices lead, which notes you see, and which waitlist you join. You can change it any time.</p>
        <MarketChoice />
      </div>
    );
  const n = (fresh ?? data?.counts)?.[market.id] ?? 0;
  return (
    <div className="card panel market-panel">
      <div className="market-panel-head">
        <span className="market-flag big"><Flag id={market.id} size={42} /></span>
        <div>
          <span className="unit">Your market</span>
          <h3>{market.name}</h3>
        </div>
        <MarketChoice compact />
      </div>
      <p>{market.tagline}</p>
      <div className="market-features">
        {(["prices", "alerts", "lending"] as const).map((f) => (
          <div key={f} className={`market-feature ${market.features[f]}`}>
            <span className="unit">{f === "prices" ? "Overnight prices" : f === "alerts" ? "Weekend alerts" : "Lending"}</span>
            <b>{READINESS_LABEL[market.features[f]]}</b>
          </div>
        ))}
      </div>
      <p className="market-legal">{market.legal}</p>
      <p className="market-next">
        {market.next}
        {data?.enabled && n > 0 ? ` ${n.toLocaleString()} ${n === 1 ? "person is" : "people are"} on this waitlist.` : ""}
      </p>
      {data?.enabled !== false && <WaitlistForm market={market} onJoined={setFresh} />}
    </div>
  );
}

/** One-line market note for the App: what the chosen market allows, with a link to change it. */
export function MarketNotice() {
  const [market] = useMarket();
  if (!market) return null;
  const practice = market.features.lending === "soon";
  return (
    <p className={`market-notice ${practice ? "warn" : ""}`}>
      <Flag id={market.id} size={16} />{" "}
      {practice
        ? `${market.name}: lending isn't offered here yet. Everything on this page is practice with paper or demo tokens that have no value.`
        : `${market.name}: demo lending with tokens that have no value, on unaudited contracts.`}{" "}
      <a href="/#market">Change market</a>
    </p>
  );
}

/** Profile card: the visitor's market preference (it lives in this browser, not on the server). */
export function ProfileMarket() {
  return (
    <section className="block pf-page">
      <div className="wrap">
        <div className="card panel market-panel">
          <div>
            <span className="unit">Preferences</span>
            <h3>Your market</h3>
          </div>
          <p className="muted">Decides which prices lead, which notes you see and which waitlist you join. Saved in this browser.</p>
          <MarketChoice />
        </div>
      </div>
    </section>
  );
}
