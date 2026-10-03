import { LOCALES } from "@veriqall/shared";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { LANDING_PUBLISHED, SITE_URL } from "./site";

// Metadata for the landing page in the language of the request: title and description, Open
// Graph and Twitter cards with the shared image, canonical address, and indexing only once the
// page is published. The language is chosen by cookie, not by address, so there is one address
// and no alternate per language.
export async function landingMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations("landing.meta");
  const title = `VeriQall – ${t("title")}`;
  const description = t("description");
  const image = { url: "/brand/og-image.png", width: 1200, height: 630, alt: "VeriQall" };
  return {
    title: { absolute: title },
    description,
    metadataBase: new URL(SITE_URL),
    alternates: { canonical: "/" },
    robots: LANDING_PUBLISHED ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      type: "website",
      url: "/",
      siteName: "VeriQall",
      title,
      description,
      locale: LOCALES[locale].tag.replace("-", "_"),
      images: [image],
    },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}
