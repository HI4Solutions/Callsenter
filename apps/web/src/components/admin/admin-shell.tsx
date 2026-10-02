"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { type Tab, TabNav } from "@/components/tab-nav";
import { API_URL, type Me } from "@/lib/auth";

// The superadmin portal's tabs (docs/plan.md, section 10). Tabs without href come later.
const TABS: Omit<Tab, "active">[] = [
  { label: "Callsentre", icon: "building", href: "/admin/callsentre" },
  { label: "Brukere", icon: "users", href: "/admin/brukere" },
  { label: "Meldinger", icon: "message", href: "/admin/meldinger" },
  { label: "Vekst", icon: "growth", href: "/admin/vekst" },
  { label: "Roller og moduler", icon: "roles", href: "/admin/roller" },
  { label: "Økonomi", icon: "wallet", later: "Fase 2 og 4" },
  { label: "System", icon: "settings", later: "Fase 2" },
  { label: "Sikkerhet", icon: "shield", href: "/admin/sikkerhet" },
];

type Access = { status: "loading" } | { status: "denied"; reason: string } | { status: "ok"; me: Me };

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [access, setAccess] = useState<Access>(
    API_URL ? { status: "loading" } : { status: "denied", reason: "API-adressen er ikke satt opp." },
  );

  useEffect(() => {
    if (!API_URL) return;
    let cancelled = false;
    fetch(`${API_URL}/me`, { credentials: "include" })
      .then(async (res) => (res.ok ? ((await res.json()) as Me) : null))
      .catch(() => null)
      .then((me) => {
        if (cancelled) return;
        if (!me) setAccess({ status: "denied", reason: "Du må logge inn for å bruke superadmin." });
        else if (!me.platformAdmin) {
          setAccess({
            status: "denied",
            reason:
              me.provider === "bankid"
                ? "Du har ikke tilgang til superadmin."
                : "Superadmin krever innlogging med BankID. Logg ut og logg inn igjen med BankID.",
          });
        } else setAccess({ status: "ok", me });
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
