"use client";

import { useEffect, useRef } from "react";

const KEY = "ns.audio.t";
const MUTE_KEY = "ns.audio.muted";
const VOLUME = 0.58;

export const readMuted = () => {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * The Nightshift soundtrack. Browsers only allow sound after the visitor interacts with the page, so it starts
 * immediately where permitted, otherwise on the first click, tap or key press anywhere (including inside the engine
 * scene, which forwards its first interaction here). Playback position carries over between pages. The Sound switch
 * in the menu (ExplorePanel) turns it off with an "ns:audio-toggle" event, and the choice is remembered on this browser.
 */
export function AlwaysOnAudio() {
  const mutedRef = useRef(false);

  useEffect(() => {
    const audio = new Audio("/engine/soundtrack.m4a");
    audio.loop = true;
    audio.volume = VOLUME;
    audio.preload = "auto";
    mutedRef.current = readMuted();
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
    // the menu's Sound switch
    const onToggle = () => {
      const next = !mutedRef.current;
      mutedRef.current = next;
      try {
        localStorage.setItem(MUTE_KEY, next ? "1" : "0");
      } catch {
        /* storage blocked: the choice lasts for this page only */
      }
      if (next) audio.pause();
      else audio.play().catch(() => {});
      window.dispatchEvent(new CustomEvent("ns:audio-state", { detail: next }));
    };
    window.addEventListener("ns:audio-toggle", onToggle);
    const timer = setInterval(save, 1000);
    window.addEventListener("pagehide", save);
    return () => {
      save();
      clearInterval(timer);
      detach();
      window.removeEventListener("message", onMessage);
      window.removeEventListener("pagehide", save);
      window.removeEventListener("ns:audio-duck", onDuck);
      window.removeEventListener("ns:audio-toggle", onToggle);
      audio.pause();
    };
  }, []);

  return null;
}
