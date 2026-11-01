import { importPKCS8, SignJWT } from "jose";
import { connect, constants, type ClientHttp2Session } from "node:http2";

/**
 * Shared shape of the lock-screen state. Must match `ContentState` in
 * apps/mobile/targets/live-activity/NightshiftSignalsAttributes.swift field for field.
 * Percent values (1.23 = +1.23%); time as Unix seconds (ActivityKit's default Date decoding is not Unix).
 */
export interface LiveState {
  status: "tracking" | "graded" | "void";
  retPct: number;
  vsSpyPct: number | null;
  legs: { ticker: string; chgPct: number }[];
  updatedAt: number;
}

export type LiveEvent = "update" | "end";

export interface LiveTarget {
  platform: "ios" | "android";
  pushToken: string;
  basketId: string;
}

/** "gone" means the token is dead (activity dismissed, app removed); stop sending to it. */
export interface LiveActivitySender {
  send(target: LiveTarget, event: LiveEvent, state: LiveState, opts: { staleAt?: number; dismissAt?: number }): Promise<"ok" | "gone">;
}

/** APNs body for a Live Activity update or end. */
export function liveActivityPayload(event: LiveEvent, state: LiveState, opts: { staleAt?: number; dismissAt?: number } = {}) {
  return {
    aps: {
      timestamp: state.updatedAt,
      event,
      "content-state": state,
      ...(opts.staleAt ? { "stale-date": opts.staleAt } : {}),
      ...(event === "end" && opts.dismissAt ? { "dismissal-date": opts.dismissAt } : {}),
      ...(event === "end" ? { alert: { title: "Nightshift Signals", body: endLine(state) } } : {}),
    },
  };
}

export function endLine(s: LiveState): string {
  if (s.status === "void") return "Basket voided at the open.";
  const sign = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;
  return `Your basket closed ${sign(s.retPct)} at the open${s.vsSpyPct === null ? "" : `, ${sign(s.vsSpyPct)} vs SPY`}.`;
}

export interface ApnsConfig {
  teamId: string;
  keyId: string;
  /** Contents of the .p8 key from the Apple Developer account. */
  privateKey: string;
  /** The app's bundle id; the topic is `<bundleId>.push-type.liveactivity`. */
  bundleId: string;
  production: boolean;
}

const TOKEN_TTL_MS = 50 * 60 * 1000;

/** ActivityKit push-to-update over APNs (token-based auth, HTTP/2). */
export class ApnsLiveActivitySender {
  private jwt: { value: string; at: number } | null = null;
  private session: ClientHttp2Session | null = null;

  constructor(private cfg: ApnsConfig) {}

  async authToken(now = Date.now()): Promise<string> {
    if (this.jwt && now - this.jwt.at < TOKEN_TTL_MS) return this.jwt.value;
    const key = await importPKCS8(this.cfg.privateKey, "ES256");
    const value = await new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: this.cfg.keyId }).setIssuer(this.cfg.teamId).setIssuedAt(Math.floor(now / 1000)).sign(key);
    this.jwt = { value, at: now };
    return value;
  }

  async send(target: LiveTarget, event: LiveEvent, state: LiveState, opts: { staleAt?: number; dismissAt?: number }): Promise<"ok" | "gone"> {
    const body = JSON.stringify(liveActivityPayload(event, state, opts));
    const headers = {
      [constants.HTTP2_HEADER_METHOD]: "POST",
      [constants.HTTP2_HEADER_PATH]: `/3/device/${target.pushToken}`,
      authorization: `bearer ${await this.authToken()}`,
      "apns-topic": `${this.cfg.bundleId}.push-type.liveactivity`,
      "apns-push-type": "liveactivity",
      "apns-priority": event === "end" ? "10" : "5",
      "content-type": "application/json",
    };
    const { status, reason } = await new Promise<{ status: number; reason: string }>((resolve, reject) => {
      const req = this.client().request(headers);
      let data = "";
      let status = 0;
      req.setEncoding("utf8");
      req.on("response", (h) => (status = Number(h[constants.HTTP2_HEADER_STATUS])));
      req.on("data", (c: string) => (data += c));
      req.on("end", () => resolve({ status, reason: data ? ((JSON.parse(data) as { reason?: string }).reason ?? "") : "" }));
      req.on("error", reject);
      req.setTimeout(10_000, () => req.close());
      req.end(body);
    });
    if (status === 200) return "ok";
    if (status === 410 || reason === "BadDeviceToken" || reason === "Unregistered") return "gone";
    throw new Error(`apns ${status} ${reason}`);
  }

  private client(): ClientHttp2Session {
    if (!this.session || this.session.closed || this.session.destroyed) {
      this.session = connect(this.cfg.production ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com");
      this.session.on("error", () => (this.session = null));
    }
    return this.session;
  }
}

/**
 * Android: a data-only push through Expo's push service. The app's background task turns it into
 * an ongoing (sticky) notification. Data-only messages need no title or body.
 */
export class ExpoLivePushSender {
  constructor(
    private accessToken: string | null = null,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async send(target: LiveTarget, event: LiveEvent, state: LiveState): Promise<"ok" | "gone"> {
    const res = await this.fetchImpl("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}) },
      body: JSON.stringify([{ to: target.pushToken, priority: "high", _contentAvailable: true, data: { kind: "nightshift-signals.live", event, basketId: target.basketId, state } }]),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`expo push: HTTP ${res.status}`);
    const ticket = ((await res.json()) as { data: { status: string; details?: { error?: string } }[] }).data[0];
    if (ticket?.status === "ok") return "ok";
    if (ticket?.details?.error === "DeviceNotRegistered") return "gone";
    throw new Error(`expo push: ${ticket?.details?.error ?? "unknown error"}`);
  }
}

/** Routes each target to its platform's sender. */
export class PlatformLiveSender implements LiveActivitySender {
  constructor(
    private ios: ApnsLiveActivitySender | null,
    private android: ExpoLivePushSender | null,
  ) {}

  async send(t: LiveTarget, event: LiveEvent, state: LiveState, opts: { staleAt?: number; dismissAt?: number }) {
    const s = t.platform === "ios" ? this.ios : this.android;
    if (!s) return "ok" as const;
    return s.send(t, event, state, opts);
  }
}
