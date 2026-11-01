"use client";
import { useEffect, useRef, useState } from "react";
import { API_URL } from "./api";

export interface WsMessage<T = unknown> {
  type: "snapshot" | "delta" | "error";
  channel: string;
  seq?: number;
  event?: string;
  data?: T;
  error?: string;
}

type Listener = (m: WsMessage) => void;

/**
 * One socket per tab. Resubscribes after reconnect (exponential backoff), and on a gap in a channel's
 * sequence numbers asks the subscriber to refetch over REST instead of guessing what it missed.
 */
class Socket {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private tokens = new Map<string, string | undefined>();
  private lastSeq = new Map<string, number>();
  private backoff = 1000;
  private statusListeners = new Set<(up: boolean) => void>();
  up = false;

  subscribe(channel: string, fn: Listener, token?: string) {
    const set = this.listeners.get(channel) ?? new Set();
    set.add(fn);
    this.listeners.set(channel, set);
    this.tokens.set(channel, token);
    if (!this.ws) this.connect();
    else if (this.ws.readyState === WebSocket.OPEN && set.size === 1) this.send({ op: "subscribe", channel, token });
    return () => {
      set.delete(fn);
      if (set.size === 0) {
        this.listeners.delete(channel);
        this.lastSeq.delete(channel);
        if (this.ws?.readyState === WebSocket.OPEN) this.send({ op: "unsubscribe", channel });
      }
    };
  }

  onStatus(fn: (up: boolean) => void) {
    this.statusListeners.add(fn);
    return () => void this.statusListeners.delete(fn);
  }

  private connect() {
    const url = API_URL.replace(/^http/, "ws") + "/ws";
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.backoff = 1000;
      this.setUp(true);
      for (const channel of this.listeners.keys()) this.send({ op: "subscribe", channel, token: this.tokens.get(channel) });
    };
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data)) as WsMessage;
      if (m.type === "snapshot") this.lastSeq.set(m.channel, m.seq ?? 0);
      if (m.type === "delta" && m.seq !== undefined) {
        const last = this.lastSeq.get(m.channel);
        this.lastSeq.set(m.channel, m.seq);
        if (last !== undefined && m.seq !== last + 1) {
          for (const fn of this.listeners.get(m.channel) ?? []) fn({ type: "error", channel: m.channel, error: "gap" });
        }
      }
      for (const fn of this.listeners.get(m.channel) ?? []) fn(m);
    };
    this.ws.onclose = () => {
      this.setUp(false);
      this.ws = null;
      if (this.listeners.size === 0) return;
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30_000);
    };
  }

  private send(m: object) {
    this.ws?.send(JSON.stringify(m));
  }

  private setUp(up: boolean) {
    this.up = up;
    for (const fn of this.statusListeners) fn(up);
  }
}

let socket: Socket | null = null;
const getSocket = () => (socket ??= new Socket());

/** Subscribes to a channel for the component's lifetime. `onGap` should refetch over REST. */
export function useChannel<T>(channel: string | null, onMessage: (m: WsMessage<T>) => void, opts: { token?: string; onGap?: () => void } = {}) {
  const handler = useRef(onMessage);
  handler.current = onMessage;
  const gap = useRef(opts.onGap);
  gap.current = opts.onGap;
  useEffect(() => {
    if (!channel) return;
    return getSocket().subscribe(
      channel,
      (m) => {
        if (m.type === "error" && m.error === "gap") gap.current?.();
        else handler.current(m as WsMessage<T>);
      },
      opts.token,
    );
  }, [channel, opts.token]);
}

/** True once the socket has been down for more than `afterMs` (shows the stale banner). */
export function useStale(afterMs = 15_000) {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const s = getSocket();
    const update = (up: boolean) => {
      if (timer) clearTimeout(timer);
      if (up) setStale(false);
      else timer = setTimeout(() => setStale(true), afterMs);
    };
    if (!s.up) update(false);
    const off = s.onStatus(update);
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [afterMs]);
  return stale;
}
