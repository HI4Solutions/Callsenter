import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";
import { landingMetadata } from "@/lib/landing-metadata";

// The landing page without login, for local work (docs/plan.md, section 20). A .dev.tsx page:
// next.config.ts only builds it in development, so on staging and production /landingsside does
// not exist; there superadmins see it at /forhandsvisning/landingsside. Publishing is the
// NEXT_PUBLIC_LANDING_PUBLISHED switch (src/lib/site.ts): then / shows the page and search
// engines may index it.
export function generateMetadata(): Promise<Metadata> {
  return landingMetadata();
}

export default function LandingPreviewPage() {
  return <LandingPage />;
}
