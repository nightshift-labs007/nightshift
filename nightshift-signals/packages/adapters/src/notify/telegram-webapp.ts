import { createHmac, timingSafeEqual } from "node:crypto";

export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  username?: string;
  language_code?: string;
}

/**
 * Validates Telegram Mini App init data: secret = HMAC_SHA256("WebAppData", bot_token);
 * hash = hex(HMAC_SHA256(secret, data_check_string)), where data_check_string is every other
 * field as key=value, sorted, joined by newlines. Rejects data older than `maxAgeS`.
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  opts: { maxAgeS?: number; now?: number } = {},
): { user: TelegramWebAppUser; startParam: string | null } | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(check).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const authDate = Number(params.get("auth_date"));
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > (opts.maxAgeS ?? 86_400)) return null;
  try {
    const user = JSON.parse(params.get("user") ?? "null") as TelegramWebAppUser | null;
    return user?.id ? { user, startParam: params.get("start_param") } : null;
  } catch {
    return null;
  }
}

/** Thin Bot API client for the webhook and setup. */
export class TelegramBot {
  constructor(
    private token: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  call<T = unknown>(method: string, body: object): Promise<T> {
    return this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    }).then(async (r) => {
      const j = (await r.json()) as { ok: boolean; result: T; description?: string };
      if (!j.ok) throw new Error(`telegram ${method}: ${j.description}`);
      return j.result;
    });
  }
}
