"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { type Tab, TabNav } from "@/components/tab-nav";
import { API_URL, fetchMe, loginPathFor, type Me } from "@/lib/auth";
import { usePageTitle } from "@/lib/use-page-title";

const TABS: (Omit<Tab, "active" | "href"> & { href: string; permission?: string })[] = [
  { label: "Brukere", icon: "users", href: "/administrasjon" },
  { label: "Team", icon: "team", href: "/administrasjon/team" },
  { label: "Roller", icon: "roles", href: "/administrasjon/roller", permission: "roles.manage" },
  { label: "Meldinger", icon: "message", href: "/administrasjon/meldinger" },
];

const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);

type Access = { status: "loading" } | { status: "denied"; reason: string } | { status: "ok"; me: Me };

// The call centre's admin portal: needs users.manage in the current call centre, which in turn
// needs a BankID or passkey session.
export function OrgShell({ children }: { children: React.ReactNode }) {
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
  }, [entryPath, router]);

  // The tab title appears only once access is confirmed, so a signed-out visitor never sees it.
  usePageTitle(access.status === "ok" ? "Administrasjon · VeriQall" : null);

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
      <TabNav
        label="Administrasjon"
        labelsFrom="sm"
        tabs={TABS.filter((tab) => !tab.permission || access.me.permissions.includes(tab.permission)).map((tab) => ({
          ...tab,
          active: tab.href === "/administrasjon" ? pathname === tab.href : pathname.startsWith(tab.href),
        }))}
      />
      <div className="mt-8">{children}</div>
    </MeContext.Provider>
  );
}
