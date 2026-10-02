"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { type Tab, TabNav } from "@/components/tab-nav";
import { API_URL, fetchMe, loginPathFor, type Me } from "@/lib/auth";
import { usePageTitle } from "@/lib/use-page-title";

// The superadmin portal's tabs (docs/plan.md, section 10). Tabs without href come later.
const TABS: Omit<Tab, "active">[] = [
  { label: "Callsentre", icon: "building", href: "/admin/callsentre" },
  { label: "Brukere", icon: "users", href: "/admin/brukere" },
  { label: "Meldinger", icon: "message", href: "/admin/meldinger" },
  { label: "Vekst", icon: "growth", href: "/admin/vekst" },
  { label: "Roller og moduler", icon: "roles", href: "/admin/roller" },
  { label: "Økonomi", icon: "wallet", href: "/admin/okonomi" },
  { label: "System", icon: "settings", href: "/admin/system" },
  { label: "Sikkerhet", icon: "shield", href: "/admin/sikkerhet" },
];

type Access = { status: "loading" } | { status: "denied"; reason: string } | { status: "ok"; me: Me };

export function AdminShell({ children }: { children: React.ReactNode }) {
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
      // Signed out: straight to login, without showing that this page exists.
      if (me === "signed-out") router.replace(loginPathFor(entryPath));
      else if (!me) setAccess({ status: "denied", reason: "Får ikke kontakt med serveren. Prøv igjen om litt." });
      else if (!me.platformAdmin) {
        setAccess({
          status: "denied",
          reason: me.strongAuthentication
            ? "Du har ikke tilgang til superadmin."
            : "Superadmin krever innlogging med BankID eller passkey.",
        });
      } else setAccess({ status: "ok", me });
    });
    return () => {
      cancelled = true;
    };
  }, [entryPath, router]);

  // The tab title appears only once access is confirmed, so a signed-out visitor never sees it.
  usePageTitle(access.status === "ok" ? "Superadmin · VeriQall" : null);

  if (access.status === "loading") return <p className="text-muted">Laster …</p>;
  if (access.status === "denied") {
    return (
      <section className="max-w-md">
        <h1 className="text-3xl font-extrabold tracking-tight">Superadmin</h1>
        <p className="mt-4">{access.reason}</p>
        <Link href="/logg-inn?neste=/admin" className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-semibold text-on-brand">
          Logg inn
        </Link>
      </section>
    );
  }

  return (
    <div>
      <p className="text-sm font-medium uppercase tracking-wide text-muted">Superadmin</p>
      <TabNav
        label="Superadmin"
        labelsFrom="lg"
        tabs={TABS.map((tab) => ({ ...tab, active: Boolean(tab.href && pathname.startsWith(tab.href)) }))}
      />
      <div className="mt-8">{children}</div>
    </div>
  );
}
