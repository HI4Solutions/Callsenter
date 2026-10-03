import { LOCALES } from "@veriqall/shared";
import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE, resolveLocale } from "./locale";
import { loadMessages } from "./messages";

// The language for this request (src/i18n/locale.ts) and its texts. Times are shown in Norwegian
// time, where the call centres are.
export default getRequestConfig(async () => {
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value, (await headers()).get("accept-language"));
  return {
    locale,
    messages: await loadMessages(locale),
    timeZone: "Europe/Oslo",
    // A missing text shows its key in development and Norwegian never; the tests keep them complete.
    onError: (error) => console.error("i18n", LOCALES[locale].tag, error.message),
  };
});
