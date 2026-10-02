import { AdminShell } from "@/components/admin/admin-shell";

// No page title here: a signed-out visitor is sent to login and should not see "Superadmin" in
// the tab first. AdminShell sets the title once access is confirmed.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
