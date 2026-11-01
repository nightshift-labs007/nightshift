import webpush from "web-push";

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

/** "gone" means the browser revoked the subscription; delete it. */
export interface PushSender {
  send(target: PushTarget, payload: PushPayload): Promise<"ok" | "gone">;
}

/** Web Push with VAPID. Generate keys once with `npx web-push generate-vapid-keys`. */
export class WebPushSender implements PushSender {
  constructor(vapid: { publicKey: string; privateKey: string; subject: string }) {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  }

  async send(t: PushTarget, payload: PushPayload): Promise<"ok" | "gone"> {
    try {
      await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: "high" });
      return "ok";
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return "gone";
      throw e;
    }
  }
}
