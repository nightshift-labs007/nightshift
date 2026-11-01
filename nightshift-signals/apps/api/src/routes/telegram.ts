import { TelegramBot, verifyTelegramInitData } from "@nightshift-signals/adapters";
import { LOCALES, newId, type Locale } from "@nightshift-signals/core";
import { eq, sql, users } from "@nightshift-signals/db";
import { OpenAPIHono, z } from "@hono/zod-openapi";
import { signUserToken } from "../auth";
import type { ApiContext, Env } from "../context";

/** Sign-in from the Telegram Mini App, and the bot's webhook (/start opens the Mini App). */
export function telegramRoutes(ctx: ApiContext) {
  const app = new OpenAPIHono<Env>();
  const tg = ctx.telegram;
  if (!tg) return app;

  app.post("/auth/telegram", async (c) => {
    const { init_data } = z.object({ init_data: z.string().min(10) }).parse(await c.req.json());
    const verified = verifyTelegramInitData(init_data, tg.botToken);
    if (!verified) return c.json({ error: "invalid Telegram sign-in" }, 401);
    const { user, startParam } = verified;
    const [found] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.telegramId, user.id));
    let id = found?.id;
    if (!id) {
      id = newId("user");
      const lang = LOCALES.includes(user.language_code as Locale) ? user.language_code! : "en";
      const handle = user.username && /^[a-zA-Z0-9_]{3,20}$/.test(user.username) ? user.username : null;
      const taken = handle ? (await ctx.db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.handle})`, handle.toLowerCase()))).length > 0 : true;
      await ctx.db.insert(users).values({ id, telegramId: user.id, lang, handle: taken ? null : handle });
    }
    return c.json({ token: await signUserToken(ctx, id), user_id: id, start_param: startParam });
  });

  app.post("/telegram/webhook", async (c) => {
    if (c.req.header("x-telegram-bot-api-secret-token") !== tg.webhookSecret) return c.json({ error: "forbidden" }, 403);
    const update = (await c.req.json()) as { message?: { chat: { id: number }; text?: string } };
    const msg = update.message;
    if (msg?.text?.startsWith("/start")) {
      await new TelegramBot(tg.botToken).call("sendMessage", {
        chat_id: msg.chat.id,
        text: "Nightshift Signals turns overnight headlines into sector ETF baskets, hashed onchain and graded in public at 9:45 ET. Information, not advice.",
        reply_markup: { inline_keyboard: [[{ text: "Open Nightshift Signals", web_app: { url: `${tg.appUrl}/tg` } }]] },
      });
    }
    return c.json({ ok: true });
  });

  return app;
}
