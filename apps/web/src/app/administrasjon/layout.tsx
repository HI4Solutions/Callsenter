import type { Metadata } from "next";
import { OrgShell } from "@/components/org/org-shell";

export const metadata: Metadata = { title: { default: "Administrasjon", template: "%s · Administrasjon · VeriQall" } };

export default function OrgAdminLayout({ children }: { children: React.ReactNode }) {
  return <OrgShell>{children}</OrgShell>;
}
