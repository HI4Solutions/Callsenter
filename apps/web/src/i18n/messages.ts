// The pages' texts, one file per namespace and language in apps/web/messages/<locale>/. Norwegian
// is the source: a text is written in nb first, and every language must have the same keys and
// the same {placeholders} (src/i18n/messages.test.ts). A new namespace is added here.
import type { Locale } from "@veriqall/shared";

export const NAMESPACES = ["common", "shell", "login", "account", "confirm", "languages", "domain", "org", "threads", "calls", "work", "sales", "customers", "products", "complaints", "economy", "dashboard", "admin"] as const;

// Texts for pages that exist only in development (.dev.tsx, see next.config.ts): the landing page
// while it is being written. They are not loaded in production, so nothing of them ships.
export const DEV_NAMESPACES = ["landing"] as const;

export const ALL_NAMESPACES = [...NAMESPACES, ...DEV_NAMESPACES] as const;

export type Namespace = (typeof ALL_NAMESPACES)[number];

export async function loadMessages(
  locale: Locale,
): Promise<Record<Namespace, Record<string, unknown>>> {
  const wanted = process.env.NODE_ENV === "production" ? NAMESPACES : ALL_NAMESPACES;
  const entries = await Promise.all(
    wanted.map(
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
