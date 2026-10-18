"use client";

import { useEffect } from "react";

const KEY = "ns.audio.t";

/**
 * The Nightshift soundtrack, always on, with no off switch. Browsers only allow sound after the visitor
 * interacts with the page, so it starts immediately where permitted, otherwise on the first click, tap or
 * key press anywhere (including inside the engine scene, which forwards its first interaction here).
 * Playback position carries over between pages.
 */
export function AlwaysOnAudio() {
  useEffect(() => {
    const audio = new Audio("/engine/soundtrack.m4a");
    audio.loop = true;
    audio.volume = 0.58;
    audio.preload = "auto";
    try {
      const t = Number(sessionStorage.getItem(KEY));
      if (t > 0) audio.currentTime = t;
    } catch {
      /* storage unavailable */
    }

    let playing = false;
    const start = () => {
      if (playing) return;
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
      audio.volume = (e as CustomEvent<boolean>).detail ? 0.06 : 0.58;
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
  return null;
}
