import "server-only";
import { env } from "./env";

/** Sends an operational alert to Telegram when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set; otherwise logs it. */
export async function alert(text: string) {
  console.warn("[nightshift alert]", text);
  if (!env.telegramToken || !env.telegramChat) return false;
  const res = await fetch(`https://api.telegram.org/bot${env.telegramToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: env.telegramChat, text: `Nightshift: ${text}`, disable_web_page_preview: true }),
  }).catch(() => null);
  return !!res?.ok;
}
