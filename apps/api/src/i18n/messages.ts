// Translations of the API's own Norwegian texts (translate.ts), keyed by the Norwegian text with
// {placeholders} for what varies. LABELS translates the words that stand in placeholders (the
// field names the validators get). Norwegian needs no entry: it is the source.
import type { Locale } from "@veriqall/shared";

type Catalog = Record<string, string>;

export const MESSAGES: Record<Exclude<Locale, "nb">, Catalog> = {
  en: {},
  sv: {},
  da: {},
  de: {},
};

export const LABELS: Record<Exclude<Locale, "nb">, Catalog> = {
  en: {},
  sv: {},
  da: {},
  de: {},
};
