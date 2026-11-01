import { LOCALES, type Locale } from "@nightshift-signals/core/enums";
import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

export const LOCALE_COOKIE = "fp.lang";

/** Locale from the user's choice (cookie), else the browser's Accept-Language, else English. URLs stay the same. */
export default getRequestConfig(async () => {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  const accept = ((await headers()).get("accept-language") ?? "").toLowerCase();
  const locale: Locale = LOCALES.includes(chosen as Locale) ? (chosen as Locale) : (LOCALES.find((l) => accept.startsWith(l)) ?? "en");
  return { locale, messages: (await import(`../messages/${locale}.json`)).default };
});
