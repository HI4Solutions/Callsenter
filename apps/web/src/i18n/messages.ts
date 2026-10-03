// The pages' texts, one file per namespace and language in apps/web/messages/<locale>/. Norwegian
// is the source: a text is written in nb first, and every language must have the same keys and
// the same {placeholders} (src/i18n/messages.test.ts). A new namespace is added here.
import type { Locale } from "@veriqall/shared";

export const NAMESPACES = [
  "common",
  "shell",
  "login",
  "account",
  "confirm",
  "languages",
  "domain",
  "economy",
] as const;

export type Namespace = (typeof NAMESPACES)[number];

export async function loadMessages(
  locale: Locale,
): Promise<Record<Namespace, Record<string, unknown>>> {
  const entries = await Promise.all(
    NAMESPACES.map(
      async (ns) =>
        [
          ns,
          (await import(`../../messages/${locale}/${ns}.json`)).default,
        ] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<
    Namespace,
    Record<string, unknown>
  >;
}
