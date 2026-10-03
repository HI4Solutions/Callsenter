"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { LandingPage } from "@/components/landing/landing-page";
import { API_URL, fetchMe, loginPathFor } from "@/lib/auth";
import { usePageTitle } from "@/lib/use-page-title";

const PATH = "/forhandsvisning/landingsside";

type Access = { status: "loading" } | { status: "denied"; reason: "noApi" | "noServer" | "noAccess" | "needStrong" } | { status: "ok" };

// Shows the landing page to superadmins only, with the same check as the superadmin portal
// (components/admin/admin-shell.tsx). The page is rendered in the browser after /me has answered,
// so a visitor who is not a superadmin gets nothing but the login page or a refusal.
export function SuperadminPreview() {
  const router = useRouter();
  const t = useTranslations("admin.shell");
  const tl = useTranslations("landing.meta");
  const tc = useTranslations("common");
  const [access, setAccess] = useState<Access>(API_URL ? { status: "loading" } : { status: "denied", reason: "noApi" });

  useEffect(() => {
    if (!API_URL) return;
    let cancelled = false;
    fetchMe().then((me) => {
      if (cancelled) return;
      if (me === "signed-out") router.replace(loginPathFor(PATH));
      else if (!me) setAccess({ status: "denied", reason: "noServer" });
      else if (!me.platformAdmin) setAccess({ status: "denied", reason: me.strongAuthentication ? "noAccess" : "needStrong" });
      else setAccess({ status: "ok" });
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  usePageTitle(access.status === "ok" ? tl("title") : null);

  if (access.status === "loading") return <p className="text-muted">{tc("loading")}</p>;
  if (access.status === "denied") {
    return (
      <section className="max-w-md">
        <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-4">{access.reason === "noServer" ? tc("noServer") : t(`denied.${access.reason}`)}</p>
        <Link href={loginPathFor(PATH)} className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-semibold text-on-brand">
          {t("logIn")}
        </Link>
      </section>
    );
  }
  return <LandingPage />;
}
