"use client";

import { LOCALES } from "@veriqall/shared";
import { useLocale, useTranslations } from "next-intl";
import { setFormatLocale } from "@/lib/format";

// Gives the date helpers in lib/format.ts the page's language. Set while rendering (not in an
// effect), so the first dates on the page are already right.
export function FormatLocale() {
  const locale = useLocale();
  const t = useTranslations("common");
  setFormatLocale(LOCALES[locale].tag, (key, values) => t(key, values));
  return null;
}
