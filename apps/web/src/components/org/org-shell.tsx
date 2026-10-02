"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { API_URL, type Me } from "@/lib/auth";

const TABS: { label: string; href?: string; later?: string }[] = [
  { label: "Brukere", href: "/administrasjon" },
  { label: "Team", href: "/administrasjon/team" },
  { label: "Roller", later: "Kommer i neste PR" },
  { label: "Meldinger", later: "Kommer i neste PR" },
];

const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);

type Access = { status: "loading" } | { status: "denied"; reason: string } | { status: "ok"; me: Me };

// The call centre's admin portal: needs users.manage in the current call centre, which in turn
// needs a BankID or passkey session.
export function OrgShell({ children }: { children: React.ReactNode }) {
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
        if (!me) setAccess({ status: "denied", reason: "Du må logge inn." });
        else if (!me.activeOrganizationId) setAccess({ status: "denied", reason: "Du er ikke medlem av noe callsenter." });
        else if (!me.permissions.includes("users.manage")) {
          setAccess({
            status: "denied",
            reason: me.strongAuthentication
              ? "Du har ikke tilgang til administrasjonen i dette callsenteret."
              : "Administrasjon krever innlogging med BankID eller passkey. Logg ut og logg inn igjen.",
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
        <h1 className="text-3xl font-extrabold tracking-tight">Administrasjon</h1>
        <p className="mt-4">{access.reason}</p>
      </section>
    );
  }

  const orgName = access.me.organizations.find((o) => o.id === access.me.activeOrganizationId)?.name;
  return (
    <MeContext.Provider value={access.me}>
      <p className="text-sm font-medium uppercase tracking-wide text-muted">Administrasjon · {orgName}</p>
      <nav aria-label="Administrasjon" className="mt-3 -mx-4 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        <ul className="flex gap-1">
          {TABS.map((tab) => {
            const active = tab.href && (tab.href === "/administrasjon" ? pathname === tab.href : pathname.startsWith(tab.href));
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
    </MeContext.Provider>
  );
}
