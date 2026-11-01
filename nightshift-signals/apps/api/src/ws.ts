import { computeScorecard, matchesTrigger, type Envelope } from "@nightshift-signals/core";
import { eq, events, triggers } from "@nightshift-signals/db";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { verifyUserToken } from "./auth";
import type { ApiContext } from "./context";
import { liveLegs } from "./routes/public";
import { basketDetail, basketSummaries, eventView, feed, scorecardRows } from "./views";

// Protocol. Client → {op: "subscribe" | "unsubscribe", channel, token?}. Server → {type: "snapshot", channel, seq, data}
// then {type: "delta", channel, seq, event, data}. Sequence numbers are per channel; a client that sees a gap
// refetches over REST. Channels: feed, basket:{id}, scorecard, user:{id} (needs a token for that user).

export const HEARTBEAT_MS = 20_000;
const CHANNEL = /^(feed|scorecard|basket:bkt_[a-z0-9_]+|user:usr_[0-9A-Z]+)$/;

interface Client {
  ws: WebSocket;
  channels: Set<string>;
  alive: boolean;
}

export class Gateway {
  private wss = new WebSocketServer({ noServer: true });
  private subs = new Map<string, Set<Client>>();
  private seq = new Map<string, number>();
  private basketSymbols = new Map<string, Set<string>>();
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    private ctx: ApiContext,
    private instanceId: string,
  ) {}

  attach(server: Server) {
    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (new URL(req.url ?? "/", "http://x").pathname !== "/ws") return socket.destroy();
      this.wss.handleUpgrade(req, socket, head, (ws) => this.connect(ws));
    });
    this.heartbeat = setInterval(() => {
      for (const ws of this.wss.clients) {
        const client = (ws as WebSocket & { client?: Client }).client;
        if (client && !client.alive) ws.terminate();
        else if (client) (client.alive = false), ws.ping();
      }
    }, HEARTBEAT_MS);
  }

  /** Every API instance gets every event (its own consumer group) and fans out to its sockets. */
  subscribeBus() {
    const group = `api:${this.instanceId}`;
    const { bus } = this.ctx;
    bus.subscribe("event.triaged", { group }, (e) => this.onTriaged(e));
    bus.subscribe("basket.published", { group }, (e) => this.onPublished(e));
    bus.subscribe("price.tick", { group, maxAttempts: 1 }, async (e) => this.onSymbol(e.payload.symbol, "price.tick", e.payload));
    bus.subscribe("alert.drift", { group }, async (e) => this.onSymbol(e.payload.symbol, "alert.drift", e.payload));
    bus.subscribe("basket.graded", { group }, async (e) => {
      this.broadcast("scorecard", "basket.graded", e.payload);
      this.broadcast(`basket:${e.payload.basket_id}`, "basket.graded", e.payload);
    });
  }

  close() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
  }

  broadcast(channel: string, event: string, data: unknown) {
    const clients = this.subs.get(channel);
    const seq = (this.seq.get(channel) ?? 0) + 1;
    this.seq.set(channel, seq);
    if (!clients?.size) return;
    const msg = JSON.stringify({ type: "delta", channel, seq, event, data });
    for (const c of clients) c.ws.send(msg);
  }

  private connect(ws: WebSocket) {
    const client: Client = { ws, channels: new Set(), alive: true };
    (ws as WebSocket & { client?: Client }).client = client;
    ws.on("pong", () => (client.alive = true));
    ws.on("close", () => {
      for (const ch of client.channels) this.subs.get(ch)?.delete(client);
    });
    ws.on("message", (raw) => void this.onMessage(client, String(raw)));
  }

  private async onMessage(client: Client, raw: string) {
    let msg: { op?: string; channel?: string; token?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return client.ws.send(JSON.stringify({ type: "error", error: "invalid json" }));
    }
    const channel = msg.channel ?? "";
    if (msg.op === "unsubscribe") {
      client.channels.delete(channel);
      this.subs.get(channel)?.delete(client);
      return;
    }
    if (msg.op !== "subscribe" || !CHANNEL.test(channel)) {
      return client.ws.send(JSON.stringify({ type: "error", channel, error: "unknown op or channel" }));
    }
    if (channel.startsWith("user:") && (await verifyUserToken(this.ctx, msg.token)) !== channel.slice(5)) {
      return client.ws.send(JSON.stringify({ type: "error", channel, error: "unauthorized" }));
    }
    const data = await this.snapshot(channel);
    if (data === undefined) return client.ws.send(JSON.stringify({ type: "error", channel, error: "not found" }));
    client.channels.add(channel);
    const set = this.subs.get(channel) ?? new Set();
    set.add(client);
    this.subs.set(channel, set);
    client.ws.send(JSON.stringify({ type: "snapshot", channel, seq: this.seq.get(channel) ?? 0, data }));
  }

  private async snapshot(channel: string): Promise<unknown> {
    const { db } = this.ctx;
    if (channel === "feed") return { items: await feed(db, { minSeverity: 2, limit: 30 }) };
    if (channel === "scorecard") return { summary: computeScorecard(await scorecardRows(db, {})) };
    if (channel.startsWith("user:")) return { user_id: channel.slice(5) };
    const id = channel.slice("basket:".length);
    const d = await basketDetail(db, id);
    if (!d) return undefined;
    this.basketSymbols.set(id, new Set(d.basket.legs.map((l) => l.token_symbol)));
    return { live: await liveLegs(this.ctx, d.basket), status: d.basket.status };
  }

  private async onTriaged(e: Envelope<"event.triaged">) {
    const [ev] = await this.ctx.db.select().from(events).where(eq(events.id, e.payload.event_id));
    if (ev) this.broadcast("feed", "event.triaged", { event: eventView(ev) });

    // Personal alerts: every active trigger is evaluated on every triaged event.
    const active = await this.ctx.db.select().from(triggers).where(eq(triggers.active, true));
    for (const t of active) {
      if (matchesTrigger(t.compiledRule, e.payload)) {
        this.broadcast(`user:${t.userId}`, "trigger.matched", { trigger_id: t.id, nl_text: t.nlText, event: ev ? eventView(ev) : null });
      }
    }
  }

  private async onPublished(e: Envelope<"basket.published">) {
    const summary = (await basketSummaries(this.ctx.db, [e.payload.basket_id])).get(e.payload.basket_id);
    const [ev] = await this.ctx.db.select().from(events).where(eq(events.id, e.payload.event_id));
    if (summary && ev) this.broadcast("feed", "basket.published", { event: eventView(ev), basket: summary });
  }

  private async onSymbol(symbol: string, event: string, data: unknown) {
    for (const [id, symbols] of this.basketSymbols) {
      if (!this.subs.get(`basket:${id}`)?.size) {
        this.basketSymbols.delete(id);
        continue;
      }
      if (symbols.has(symbol)) this.broadcast(`basket:${id}`, event, data);
    }
  }
}
