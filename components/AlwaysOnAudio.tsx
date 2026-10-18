"use client";

import { useEffect, useRef, useState } from "react";

const KEY = "ns.audio.t";
const MUTE_KEY = "ns.audio.muted";
const VOLUME = 0.58;

const readMuted = () => {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * The Nightshift soundtrack. Browsers only allow sound after the visitor interacts with the page, so it starts
 * immediately where permitted, otherwise on the first click, tap or key press anywhere (including inside the engine
 * scene, which forwards its first interaction here). Playback position carries over between pages. The Sound button
 * turns it off, and the choice is remembered on this browser.
 */
export function AlwaysOnAudio() {
  const [muted, setMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mutedRef = useRef(false);

  useEffect(() => {
    const audio = new Audio("/engine/soundtrack.m4a");
    audioRef.current = audio;
    audio.loop = true;
    audio.volume = VOLUME;
    audio.preload = "auto";
    mutedRef.current = readMuted();
    setMuted(mutedRef.current);
    try {
      const t = Number(sessionStorage.getItem(KEY));
      if (t > 0) audio.currentTime = t;
    } catch {
      /* storage unavailable */
    }

    let playing = false;
    const start = () => {
      if (playing || mutedRef.current) return;
      audio.play().then(
        () => {
          playing = true;
          detach();
        },
        () => {
          /* not allowed yet: wait for the next interaction */
        },
      );
    };
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data?.type === "ns-audio-start") start();
    };
    const detach = () => events.forEach((ev) => window.removeEventListener(ev, start, true));
    events.forEach((ev) => window.addEventListener(ev, start, true));
    window.addEventListener("message", onMessage);
    start();

    const save = () => {
      try {
        sessionStorage.setItem(KEY, String(audio.currentTime));
      } catch {
        /* storage unavailable */
      }
    };
    // Nyx (the voice assistant) dips the music while it listens or speaks
    const onDuck = (e: Event) => {
      audio.volume = (e as CustomEvent<boolean>).detail ? 0.06 : VOLUME;
    };
    window.addEventListener("ns:audio-duck", onDuck);
    const timer = setInterval(save, 1000);
    window.addEventListener("pagehide", save);
    return () => {
      save();
      clearInterval(timer);
      detach();
      window.removeEventListener("message", onMessage);
      window.removeEventListener("pagehide", save);
      window.removeEventListener("ns:audio-duck", onDuck);
      audio.pause();
    };
  }, []);

  const toggle = () => {
    const next = !muted;
    setMuted(next);
    mutedRef.current = next;
    try {
      localStorage.setItem(MUTE_KEY, next ? "1" : "0");
    } catch {
      /* storage blocked: the choice lasts for this page only */
    }
    const a = audioRef.current;
    if (!a) return;
    if (next) a.pause();
    else a.play().catch(() => {});
  };

  return (
    <button className={`sound-fab ${muted ? "off" : ""}`} onClick={toggle} aria-pressed={!muted} aria-label={muted ? "Turn the soundtrack on" : "Turn the soundtrack off"} title={muted ? "Sound off: click to turn on" : "Sound on: click to turn off"}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 9h4l5-4v14l-5-4H4z" />
        {muted ? <path d="M17 9l5 6M22 9l-5 6" /> : <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />}
      </svg>
      <span>{muted ? "Sound off" : "Sound on"}</span>
    </button>
  );
}
