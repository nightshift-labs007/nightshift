// pnpm telegram:setup
// Registers the bot webhook (/start replies with an "Open Nightshift Signals" button) and sets the chat menu
// button to open the Mini App. Create the Mini App in @BotFather first (/newapp, URL = APP_URL/tg)
// and put its direct link in TELEGRAM_MINIAPP_LINK so channel posts can deep-link into baskets.
import { TelegramBot } from "@nightshift-signals/adapters";

const { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, API_PUBLIC_URL, APP_URL } = process.env;
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET || !API_PUBLIC_URL || !APP_URL) {
  console.error("needs TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, API_PUBLIC_URL and APP_URL (both https)");
  process.exit(2);
}
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
await bot.call("setWebhook", { url: `${API_PUBLIC_URL}/v1/telegram/webhook`, secret_token: TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message"] });
await bot.call("setChatMenuButton", { menu_button: { type: "web_app", text: "Nightshift Signals", web_app: { url: `${APP_URL}/tg` } } });
console.log(`[telegram] webhook → ${API_PUBLIC_URL}/v1/telegram/webhook, menu button → ${APP_URL}/tg`);
