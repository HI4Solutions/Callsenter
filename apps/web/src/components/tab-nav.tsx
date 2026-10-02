"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";

export interface Tab {
  label: string;
  icon: IconName;
  // Without href the tab is shown as coming later (and hidden on small screens).
  href?: string;
  later?: string;
  active?: boolean;
}

// From which width the tabs show their names; below it they are icons that share the width
// evenly, so the row fits a phone without scrolling. Literal class names, for Tailwind.
const BREAKPOINT = {
  sm: { label: "sr-only sm:not-sr-only", later: "hidden sm:flex", row: "sm:flex sm:gap-1", cell: "sm:flex-none", link: "sm:justify-start sm:px-3" },
  lg: { label: "sr-only lg:not-sr-only", later: "hidden lg:flex", row: "lg:flex lg:gap-0.5", cell: "lg:flex-none", link: "lg:justify-start lg:gap-1.5 lg:px-2" },
} as const;

export function TabNav({ label, tabs, labelsFrom }: { label: string; tabs: Tab[]; labelsFrom: keyof typeof BREAKPOINT }) {
  const bp = BREAKPOINT[labelsFrom];
  return (
    <nav aria-label={label} className="mt-3 border-b border-line print:hidden">
      <ul className={`grid auto-cols-fr grid-flow-col ${bp.row}`}>
        {tabs.map((tab) => (
          <li key={tab.label} className={`${tab.href ? "flex" : bp.later} ${bp.cell}`}>
            {tab.href ? (
              <Link
                href={tab.href}
                title={tab.label}
                aria-current={tab.active ? "page" : undefined}
                className={`inline-flex min-h-12 w-full items-center justify-center gap-2 whitespace-nowrap border-b-2 px-1 font-semibold ${bp.link} ${
                  tab.active ? "border-brand text-brand" : "border-transparent text-muted hover:text-fg"
                }`}
              >
                <Icon name={tab.icon} className="size-6 shrink-0 lg:size-5" />
                <span className={bp.label}>{tab.label}</span>
              </Link>
            ) : (
              <span
                title={tab.later}
                className={`inline-flex min-h-12 w-full cursor-not-allowed items-center justify-center gap-2 whitespace-nowrap border-b-2 border-transparent px-1 text-muted opacity-60 ${bp.link}`}
              >
                <Icon name={tab.icon} className="size-6 shrink-0 lg:size-5" />
                <span className={bp.label}>{tab.label}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
