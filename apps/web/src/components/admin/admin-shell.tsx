"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { type Tab, TabNav } from "@/components/tab-nav";
import { API_URL, fetchMe, loginPathFor, type Me } from "@/lib/auth";
import { usePageTitle } from "@/lib/use-page-title";

// The superadmin portal's tabs (docs/plan.md, section 10). Tabs without href come later.
const TABS = [
  { key: "overview", icon: "overview", href: "/admin/oversikt" },
  { key: "organizations", icon: "building", href: "/admin/callsentre" },
  { key: "users", icon: "users", href: "/admin/brukere" },
  { key: "messages", icon: "message", href: "/admin/meldinger" },
  { key: "growth", icon: "growth", href: "/admin/vekst" },
  { key: "roles", icon: "roles", href: "/admin/roller" },
  { key: "economy", icon: "wallet", href: "/admin/okonomi" },
  { key: "system", icon: "settings", href: "/admin/system" },
  { key: "security", icon: "shield", href: "/admin/sikkerhet" },
] as const satisfies (Omit<Tab, "active" | "label"> & { key: string })[];

type DeniedReason = "noApi" | "noServer" | "noAccess" | "needStrong";
type Access =
  | { status: "loading" }
  | { status: "denied"; reason: DeniedReason }
  | { status: "ok"; me: Me };

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("admin.shell");
  const tc = useTranslations("common");
  const [access, setAccess] = useState<Access>(
    API_URL ? { status: "loading" } : { status: "denied", reason: "noApi" },
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
      else if (!me) setAccess({ status: "denied", reason: "noServer" });
      else if (!me.platformAdmin) {
        setAccess({
          status: "denied",
          reason: me.strongAuthentication ? "noAccess" : "needStrong",
        });
      } else setAccess({ status: "ok", me });
    });
    return () => {
      cancelled = true;
    };
  }, [entryPath, router]);

  // The tab title appears only once access is confirmed, so a signed-out visitor never sees it.
  usePageTitle(access.status === "ok" ? t("pageTitle") : null);

  if (access.status === "loading")
    return <p className="text-muted">{tc("loading")}</p>;
  if (access.status === "denied") {
    return (
      <section className="max-w-md">
        <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-4">
          {access.reason === "noServer"
            ? tc("noServer")
            : t(`denied.${access.reason}`)}
        </p>
        <Link
          href="/logg-inn?neste=/admin"
          className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-semibold text-on-brand"
        >
          {t("logIn")}
        </Link>
      </section>
    );
  }

  return (
    <div>
      <p className="text-sm font-medium uppercase tracking-wide text-muted">
        {t("title")}
      </p>
      <TabNav
        label={t("title")}
        labelsFrom="lg"
        tabs={TABS.map(({ key, ...tab }) => ({
          ...tab,
          label: t(`tabs.${key}`),
          active: pathname.startsWith(tab.href),
        }))}
      />
      <div className="mt-8">{children}</div>
    </div>
  );
}
