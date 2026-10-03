import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LandingPage } from "@/components/landing/landing-page";
import { SignedInRedirect } from "@/components/signed-in-redirect";
import { landingMetadata } from "@/lib/landing-metadata";
import { LANDING_PUBLISHED } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  return LANDING_PUBLISHED ? landingMetadata() : {};
}

// The front page: the landing page once it is published (docs/plan.md, section 20), until then
// straight to login. Signed-in users are sent on to their portal either way.
export default function Home() {
  if (!LANDING_PUBLISHED) redirect("/logg-inn");
  return (
    <>
      <SignedInRedirect skip={false} />
      <LandingPage />
    </>
  );
}
