import { WorkShell } from "@/components/work/work-shell";

// No page title here: a signed-out visitor is sent to login first. WorkShell sets the title once
// access is confirmed.
export default function WorkLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WorkShell>{children}</WorkShell>;
}
