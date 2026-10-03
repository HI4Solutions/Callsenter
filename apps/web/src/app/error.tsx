"use client";

import { useTranslations } from "next-intl";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("shell");
  const tc = useTranslations("common");
  return (
    <section className="max-w-2xl">
      <h1 className="text-4xl font-extrabold tracking-tight">{t("errorTitle")}</h1>
      <p className="mt-5 text-lg text-muted">{t("errorText")}</p>
      <button
        type="button"
        onClick={reset}
        className="mt-8 inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-semibold text-on-brand"
      >
        {tc("tryAgain")}
      </button>
    </section>
  );
}
