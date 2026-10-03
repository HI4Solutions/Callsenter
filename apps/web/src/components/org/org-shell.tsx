"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createContext, useContext, useEffect, useState } from "react";
import { type Tab, TabNav } from "@/components/tab-nav";
import { API_URL, fetchMe, loginPathFor, type Me } from "@/lib/auth";
import { usePageTitle } from "@/lib/use-page-title";

const TABS: (Omit<Tab, "active" | "href" | "label"> & {
  key: "overview" | "users" | "teams" | "roles" | "messages" | "invoices";
  href: string;
  permission?: string;
})[] = [
  { key: "overview", icon: "growth", href: "/administrasjon" },
  { key: "users", icon: "users", href: "/administrasjon/brukere" },
  { key: "teams", icon: "team", href: "/administrasjon/team" },
  { key: "roles", icon: "roles", href: "/administrasjon/roller", permission: "roles.manage" },
  { key: "messages", icon: "message", href: "/administrasjon/meldinger" },
  { key: "invoices", icon: "wallet", href: "/administrasjon/fakturaer", permission: "billing.read" },
];

const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);

type Reason = "noApi" | "noServer" | "noOrganization" | "noAccess" | "needsStrongLogin";
type Access = { status: "loading" } | { status: "denied"; reason: Reason } | { status: "ok"; me: Me };

// The call centre's admin portal: needs users.manage in the current call centre, which in turn
// needs a BankID or passkey session.
export function OrgShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("org.shell");
  const tc = useTranslations("common");
  const [access, setAccess] = useState<Access>(API_URL ? { status: "loading" } : { status: "denied", reason: "noApi" });

  // Access is checked once, when the portal opens; moving between its tabs keeps the shell. The
  // login redirect returns to the page the visitor came in on.
  const [entryPath] = useState(pathname);
  useEffect(() => {
    if (!API_URL) return;
    let cancelled = false;
    fetchMe().then((me) => {
      if (cancelled) return;
      if (me === "signed-out") router.replace(loginPathFor(entryPath));
      else if (!me) setAccess({ status: "denied", reason: "noServer" });
      else if (!me.activeOrganizationId) setAccess({ status: "denied", reason: "noOrganization" });
      else if (!me.permissions.includes("users.manage")) {
        setAccess({ status: "denied", reason: me.strongAuthentication ? "noAccess" : "needsStrongLogin" });
      } else setAccess({ status: "ok", me });
    });
    return () => {
      cancelled = true;
    };
  }, [entryPath, router]);

  // The tab title appears only once access is confirmed, so a signed-out visitor never sees it.
  usePageTitle(access.status === "ok" ? t("pageTitle") : null);

  if (access.status === "loading") return <p className="text-muted">{tc("loading")}</p>;
  if (access.status === "denied") {
    return (
      <section className="max-w-md">
        <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-4">{access.reason === "noServer" ? tc("noServer") : t(access.reason)}</p>
      </section>
    );
  }

  const orgName = access.me.organizations.find((o) => o.id === access.me.activeOrganizationId)?.name;
  return (
    <MeContext.Provider value={access.me}>
      <p className="text-sm font-medium uppercase tracking-wide text-muted">{t("eyebrow", { organization: orgName ?? "" })}</p>
      <TabNav
        label={t("title")}
        labelsFrom="sm"
        tabs={TABS.filter((tab) => !tab.permission || access.me.permissions.includes(tab.permission)).map(({ key, ...tab }) => ({
          ...tab,
          label: t(`tabs.${key}`),
          active: tab.href === "/administrasjon" ? pathname === tab.href : pathname.startsWith(tab.href),
        }))}
      />
      <div className="mt-8">{children}</div>
    </MeContext.Provider>
  );
}
