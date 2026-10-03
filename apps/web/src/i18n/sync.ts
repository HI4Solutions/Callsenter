// After sign-in the language follows the user: their saved choice, else the call centre's when
// this browser has no choice of its own. Reloads once when the language changes.
import { isLocale, type Locale } from "@veriqall/shared";
import { readLocaleCookie, writeLocaleCookie } from "./locale";

export function syncLocale(me: { locale?: Locale | null; organizationLocale?: Locale | null }, current: Locale) {
  const cookie = readLocaleCookie();
  const wanted = me.locale ?? (isLocale(cookie) ? null : (me.organizationLocale ?? null));
  if (!wanted || wanted === current) return;
  writeLocaleCookie(wanted);
  window.location.reload();
}
