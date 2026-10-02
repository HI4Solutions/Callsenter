"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin/okonomi", label: "Oversikt og forbruk" },
  { href: "/admin/okonomi/fakturaer", label: "Fakturaer" },
  { href: "/admin/okonomi/faste", label: "Faste avtaler" },
  { href: "/admin/okonomi/innstillinger", label: "Innstillinger" },
];

// The parts of Økonomi in the superadmin portal.
export function EconomyNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Økonomi" className="flex flex-wrap gap-2 print:hidden">
      {LINKS.map((l) => {
        const active = l.href === "/admin/okonomi" ? pathname === l.href : pathname.startsWith(l.href);
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
