"use client";
import { useEffect, useState } from "react";

const VOICE_LANG: Record<string, string> = { en: "en-US", hi: "hi-IN", es: "es-US" };

/** Recorded audio when the server has it; otherwise the device's own speech synthesis reads the script. */
export function BriefPlayer({ script, lang, audioUrl, labels }: { script: string; lang: string; audioUrl: string | null; labels: { play: string; stop: string } }) {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  if (audioUrl) return <audio controls preload="none" src={audioUrl} className="w-full" />;
  if (typeof window !== "undefined" && !("speechSynthesis" in window)) return null;

  function toggle() {
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      return setSpeaking(false);
    }
    const u = new SpeechSynthesisUtterance(script);
    u.lang = VOICE_LANG[lang] ?? lang;
    u.voice = synth.getVoices().find((v) => v.lang.startsWith(lang)) ?? null;
    u.rate = 1.02;
    u.onend = () => setSpeaking(false);
    synth.speak(u);
    setSpeaking(true);
  }

  return (
    <button type="button" onClick={toggle} className="rounded-md bg-cool px-4 py-2 text-sm font-medium text-ink" aria-pressed={speaking}>
      {speaking ? `■ ${labels.stop}` : `▶ ${labels.play}`}
    </button>
  );
}
