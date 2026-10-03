import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("shell");
  return (
    <section className="max-w-2xl">
      <p className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">404</p>
      <h1 className="text-4xl font-extrabold tracking-tight">{t("notFoundTitle")}</h1>
      <p className="mt-5 text-lg text-muted">{t("notFoundText")}</p>
      <Link href="/" className="mt-8 inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-semibold text-on-brand">
        {t("toFrontPage")}
      </Link>
    </section>
  );
}
