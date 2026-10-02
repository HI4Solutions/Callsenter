"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

const SECTIONS = [
  { href: "/admin/okonomi/forbruk", label: "Forbruk" },
  { href: "/admin/okonomi/stripe", label: "Stripe" },
  { href: "/admin/okonomi/faktura", label: "Faktura" },
  { href: "/admin/okonomi/regnskap", label: "Regnskap" },
];

const INVOICING = [
  { href: "/admin/okonomi/faktura", label: "Fakturaer" },
  { href: "/admin/okonomi/faktura/kunder", label: "Kunder" },
  { href: "/admin/okonomi/faktura/gjentakende", label: "Gjentakende" },
  { href: "/admin/okonomi/faktura/pakker", label: "Pakker" },
  { href: "/admin/okonomi/faktura/innstillinger", label: "Innstillinger" },
];

export const LAST_SECTION_KEY = "veriqall.okonomi";
const INVOICE_PAGE = /^\/admin\/okonomi\/faktura\/[0-9a-f-]{36}$/;

function Links({ links, label, exact }: { links: { href: string; label: string }[]; label: string; exact: (href: string) => boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2 print:hidden">
      {links.map((l) => {
        // An invoice's own page belongs under Fakturaer.
        const active = exact(l.href) ? pathname === l.href || INVOICE_PAGE.test(pathname) : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-lg border px-4 font-semibold ${active ? "border-brand bg-brand text-on-brand" : "border-line hover:bg-bg"}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

// The parts of Økonomi in the superadmin portal. The part last used is remembered.
export function EconomyNav() {
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
    <div className="flex flex-col gap-3">
      <Links links={SECTIONS} label="Økonomi" exact={() => false} />
      {pathname.startsWith("/admin/okonomi/faktura") && (
        <Links links={INVOICING} label="Faktura" exact={(href) => href === "/admin/okonomi/faktura"} />
      )}
    </div>
  );
}
