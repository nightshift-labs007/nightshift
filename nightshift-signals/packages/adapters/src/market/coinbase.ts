import type { PriceSource, Tick } from "./types";

/** BTC spot from Coinbase Exchange's public ticker channel. Trades 24/7. */
export class CoinbaseBtcSource implements PriceSource {
  readonly symbols = ["BTC"];
  constructor(private url = "wss://ws-feed.exchange.coinbase.com") {}

  start(onTick: (t: Tick) => void): () => void {
    let ws: WebSocket | null = null;
    let stopped = false;
    let backoff = 1000;

    const connect = () => {
      ws = new WebSocket(this.url);
      ws.onopen = () => {
        backoff = 1000;
        ws!.send(JSON.stringify({ type: "subscribe", product_ids: ["BTC-USD"], channels: ["ticker"] }));
      };
      ws.onmessage = (m) => {
        const msg = JSON.parse(String(m.data)) as { type?: string; price?: string; time?: string };
        if (msg.type === "ticker" && msg.price) onTick({ symbol: "BTC", px: msg.price, src: "spot", ts: new Date(msg.time ?? Date.now()) });
      };
      ws.onclose = () => {
        if (stopped) return;
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 30_000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      stopped = true;
      ws?.close();
    };
  }
}
