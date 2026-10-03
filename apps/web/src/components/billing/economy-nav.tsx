"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

const SECTIONS = [
  { href: "/admin/okonomi/forbruk", label: "usage" },
  { href: "/admin/okonomi/stripe", label: "stripe" },
  { href: "/admin/okonomi/faktura", label: "invoice" },
  { href: "/admin/okonomi/regnskap", label: "accounting" },
] as const;

const INVOICING = [
  { href: "/admin/okonomi/faktura", label: "invoices" },
  { href: "/admin/okonomi/faktura/kunder", label: "customers" },
  { href: "/admin/okonomi/faktura/gjentakende", label: "recurring" },
  { href: "/admin/okonomi/faktura/pakker", label: "packages" },
  { href: "/admin/okonomi/faktura/innstillinger", label: "settings" },
] as const;

type NavKey =
  | (typeof SECTIONS)[number]["label"]
  | (typeof INVOICING)[number]["label"];

export const LAST_SECTION_KEY = "veriqall.okonomi";
const INVOICE_PAGE = /^\/admin\/okonomi\/faktura\/[0-9a-f-]{36}$/;

// The parts of Økonomi as a segmented control, and the parts of Faktura as underlined links
// under it, so neither looks like a button that does something.
function Links({
  links,
  label,
  exact,
  variant,
}: {
  links: readonly { href: string; label: NavKey }[];
  label: string;
  exact: (href: string) => boolean;
  variant: "segments" | "underline";
}) {
  const t = useTranslations("economy.nav");
  const pathname = usePathname();
  const isActive = (href: string) =>
    // An invoice's own page belongs under Fakturaer.
    exact(href)
      ? pathname === href || INVOICE_PAGE.test(pathname)
      : pathname.startsWith(href);
  if (variant === "segments") {
    return (
      <nav aria-label={label} className="print:hidden">
        <ul className="grid grid-cols-4 gap-1 rounded-xl border border-line bg-bg p-1 sm:inline-flex sm:max-w-full sm:flex-wrap">
          {links.map((l) => {
            const active = isActive(l.href);
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-10 w-full items-center justify-center rounded-lg px-2 text-sm font-semibold sm:px-4 sm:text-base ${
                    active
                      ? "bg-surface text-fg shadow-sm ring-1 ring-line"
                      : "text-muted hover:text-fg"
                  }`}
                >
                  {t(l.label)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }
  return (
    <nav aria-label={label} className="border-b border-line print:hidden">
      <ul className="flex flex-wrap gap-x-5">
        {links.map((l) => {
          const active = isActive(l.href);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`-mb-px inline-flex min-h-11 items-center border-b-2 font-semibold ${
                  active
                    ? "border-brand text-brand"
                    : "border-transparent text-muted hover:text-fg"
                }`}
              >
                {t(l.label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// The parts of Økonomi in the superadmin portal. The part last used is remembered.
export function EconomyNav() {
  const t = useTranslations("economy.nav");
  const pathname = usePathname();
  useEffect(() => {
    const section = SECTIONS.find((s) => pathname.startsWith(s.href));
    if (!section) return;
    try {
      localStorage.setItem(LAST_SECTION_KEY, section.href);
    } catch {
      // Private mode: nothing to remember.
    }
  }, [pathname]);
  return (
    <div className="flex flex-col gap-4">
      <Links
        links={SECTIONS}
        label={t("label")}
        exact={() => false}
        variant="segments"
      />
      {pathname.startsWith("/admin/okonomi/faktura") && (
        <Links
          links={INVOICING}
          label={t("invoice")}
          exact={(href) => href === "/admin/okonomi/faktura"}
          variant="underline"
        />
      )}
    </div>
  );
}
