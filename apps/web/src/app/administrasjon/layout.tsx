import { OrgShell } from "@/components/org/org-shell";

// No page title here: a signed-out visitor is sent to login first. OrgShell sets the title once
// access is confirmed.
export default function OrgAdminLayout({ children }: { children: React.ReactNode }) {
  return <OrgShell>{children}</OrgShell>;
}
