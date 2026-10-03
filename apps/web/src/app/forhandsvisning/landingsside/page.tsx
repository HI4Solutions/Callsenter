import { SuperadminPreview } from "@/components/landing/superadmin-preview";

// The landing page for superadmins only, while it is being written (docs/plan.md, section 20).
// No page title here: a signed-out visitor is sent to login and should not see what this is.
export default function LandingPreviewPage() {
  return <SuperadminPreview />;
}
