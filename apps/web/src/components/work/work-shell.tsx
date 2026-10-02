"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { type Tab, TabNav } from "@/components/tab-nav";
import { API_URL, fetchMe, loginPathFor, type Me } from "@/lib/auth";
import { usePageTitle } from "@/lib/use-page-title";
import { canSeeCalls } from "@/lib/calls";
import { canSeeDashboard } from "@/lib/dashboard";
import { canSeeSales } from "@/lib/work";

// The daily work in a call centre (docs/plan.md, section 12).
const TABS: (Omit<Tab, "active" | "href"> & { href: string; show?: (me: Me) => boolean })[] = [
  { label: "Oversikt", icon: "growth", href: "/oversikt", show: canSeeDashboard },
  { label: "Samtaler", icon: "phone", href: "/samtaler", show: canSeeCalls },
  { label: "Salg", icon: "receipt", href: "/salg", show: (me) => canSeeSales(me.permissions) },
  { label: "Kunder", icon: "contacts", href: "/kunder", show: (me) => me.permissions.includes("customers.read") },
  { label: "Klager", icon: "inbox", href: "/klager", show: (me) => me.permissions.includes("complaints.manage") && (me.modules ?? []).includes("complaints") },
  { label: "Produkter", icon: "box", href: "/produkter" },
];

const MeContext = createContext<Me | null>(null);
export const useWorkMe = () => useContext(MeContext);

type Access = { status: "loading" } | { status: "denied"; reason: string } | { status: "ok"; me: Me };

// For every active member of the session's call centre. Each page checks its own permission;
// the API and the database check again.
export function WorkShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [access, setAccess] = useState<Access>(
    API_URL ? { status: "loading" } : { status: "denied", reason: "API-adressen er ikke satt opp." },
  );

  // Access is checked once, when the portal opens; moving between its tabs keeps the shell. The
  // login redirect returns to the page the visitor came in on.
  const [entryPath] = useState(pathname);
  useEffect(() => {
    if (!API_URL) return;
    let cancelled = false;
    fetchMe().then((me) => {
      if (cancelled) return;
      if (me === "signed-out") router.replace(loginPathFor(entryPath));
      else if (!me) setAccess({ status: "denied", reason: "Får ikke kontakt med serveren. Prøv igjen om litt." });
      else if (!me.activeOrganizationId) setAccess({ status: "denied", reason: "Du er ikke medlem av noe callsenter." });
      else setAccess({ status: "ok", me });
    });
    return () => {
      cancelled = true;
    };
  }, [entryPath, router]);

  const orgName =
    access.status === "ok" ? access.me.organizations.find((o) => o.id === access.me.activeOrganizationId)?.name : undefined;
  usePageTitle(access.status === "ok" ? `${orgName ?? "Callsenter"} · VeriQall` : null);

  if (access.status === "loading") return <p className="text-muted">Laster …</p>;
  if (access.status === "denied") {
    return (
      <section className="max-w-md">
        <h1 className="text-3xl font-extrabold tracking-tight">Callsenter</h1>
        <p className="mt-4">{access.reason}</p>
      </section>
    );
  }

  return (
    <MeContext.Provider value={access.me}>
      <p className="text-sm font-medium uppercase tracking-wide text-muted print:hidden">{orgName}</p>
      <TabNav
        label="Callsenter"
        labelsFrom="sm"
        tabs={TABS.filter((tab) => !tab.show || tab.show(access.me)).map((tab) => ({
          ...tab,
          active: pathname.startsWith(tab.href),
        }))}
      />
      <div className="mt-8">{children}</div>
    </MeContext.Provider>
  );
}

// Shown in place of a page the member lacks the permission for.
export function NoAccess({ text }: { text: string }) {
  return <p className="max-w-md">{text}</p>;
}
