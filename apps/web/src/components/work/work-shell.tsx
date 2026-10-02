"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { type Tab, TabNav } from "@/components/tab-nav";
import { API_URL, fetchMe, loginPathFor, type Me } from "@/lib/auth";
import { usePageTitle } from "@/lib/use-page-title";

// The daily work in a call centre. Sales come next (docs/plan.md, section 12).
const TABS: (Omit<Tab, "active" | "href"> & { href: string; permission?: string })[] = [
  { label: "Kunder", icon: "contacts", href: "/kunder", permission: "customers.read" },
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

  useEffect(() => {
    if (!API_URL) return;
    let cancelled = false;
    fetchMe().then((me) => {
      if (cancelled) return;
      if (me === "signed-out") router.replace(loginPathFor(pathname));
      else if (!me) setAccess({ status: "denied", reason: "Får ikke kontakt med serveren. Prøv igjen om litt." });
      else if (!me.activeOrganizationId) setAccess({ status: "denied", reason: "Du er ikke medlem av noe callsenter." });
      else setAccess({ status: "ok", me });
    });
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

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
      <p className="text-sm font-medium uppercase tracking-wide text-muted">{orgName}</p>
      <TabNav
        label="Callsenter"
        labelsFrom="sm"
        tabs={TABS.filter((tab) => !tab.permission || access.me.permissions.includes(tab.permission)).map((tab) => ({
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
