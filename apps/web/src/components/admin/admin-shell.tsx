"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { API_URL, type Me } from "@/lib/auth";

// The superadmin portal's tabs (docs/plan.md, section 10). Tabs without href come later.
const TABS: { label: string; href?: string; later?: string }[] = [
  { label: "Callsentre", href: "/admin/callsentre" },
  { label: "Brukere", href: "/admin/brukere" },
  { label: "Meldinger", href: "/admin/meldinger" },
  { label: "Vekst", href: "/admin/vekst" },
  { label: "Roller og moduler", href: "/admin/roller" },
  { label: "Økonomi", later: "Fase 2 og 4" },
  { label: "System", later: "Fase 2" },
  { label: "Sikkerhet", href: "/admin/sikkerhet" },
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
      <nav aria-label="Superadmin" className="mt-3 -mx-4 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        <ul className="flex gap-1">
          {TABS.map((tab) => {
            const active = tab.href && pathname.startsWith(tab.href);
            return (
              <li key={tab.label}>
                {tab.href ? (
                  <Link
                    href={tab.href}
                    aria-current={active ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 font-semibold ${
                      active ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"
                    }`}
                  >
                    {tab.label}
                  </Link>
                ) : (
                  <span
                    title={tab.later}
                    className="inline-flex min-h-11 cursor-not-allowed items-center whitespace-nowrap border-b-2 border-transparent px-3 text-muted opacity-60"
                  >
                    {tab.label}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="mt-8">{children}</div>
    </div>
  );
}
