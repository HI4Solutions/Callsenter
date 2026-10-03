import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LandingPage } from "@/components/landing/landing-page";

// The landing page without login, for local work (docs/plan.md, section 20). A .dev.tsx page:
// next.config.ts only builds it in development, so on staging and production /landingsside does
// not exist; there superadmins see it at /forhandsvisning/landingsside. To publish it: render
// <LandingPage /> from src/app/page.tsx instead of the redirect to /logg-inn, and let search
// engines index / (next.config.ts and layout.tsx say noindex for the whole app).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("landing.meta");
  return { title: t("title"), description: t("description") };
}

export default function LandingPreviewPage() {
  return <LandingPage />;
}
