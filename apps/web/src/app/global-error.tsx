"use client";

import "./globals.css";
import { LOCALES } from "@veriqall/shared";
import { readLocaleCookie, resolveLocale } from "@/i18n/locale";

// Replaces the root layout when it fails, so it brings its own <html> and <body>, and its own
// texts: the message files may be what failed to load.
const TEXT = {
  nb: { title: "Noe gikk galt", text: "Vi klarte ikke å laste VeriQall. Prøv igjen om litt.", retry: "Prøv igjen" },
  en: { title: "Something went wrong", text: "We couldn't load VeriQall. Please try again shortly.", retry: "Try again" },
  sv: { title: "Något gick fel", text: "Vi kunde inte ladda VeriQall. Försök igen om en stund.", retry: "Försök igen" },
  da: { title: "Noget gik galt", text: "Vi kunne ikke indlæse VeriQall. Prøv igen om lidt.", retry: "Prøv igen" },
  de: { title: "Etwas ist schiefgelaufen", text: "VeriQall konnte nicht geladen werden. Bitte versuchen Sie es gleich noch einmal.", retry: "Erneut versuchen" },
} satisfies Record<keyof typeof LOCALES, { title: string; text: string; retry: string }>;

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const locale =
    typeof document === "undefined" ? "nb" : resolveLocale(readLocaleCookie(), navigator.languages?.join(",") ?? navigator.language);
  const t = TEXT[locale];
  return (
    <html lang={LOCALES[locale].tag}>
      <body className="min-h-dvh px-4 py-16 sm:px-6">
        <main className="mx-auto max-w-2xl">
          <h1 className="text-4xl font-extrabold tracking-tight">{t.title}</h1>
          <p className="mt-5 text-lg text-muted">{t.text}</p>
          <button
            type="button"
            onClick={reset}
            className="mt-8 inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-semibold text-on-brand"
          >
            {t.retry}
          </button>
        </main>
      </body>
    </html>
  );
}
