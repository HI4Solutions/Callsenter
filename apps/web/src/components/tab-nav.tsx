"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Icon, type IconName } from "@/components/icons";

export interface Tab {
  label: string;
  icon: IconName;
  // Without href the tab is shown as coming later (and hidden on small screens).
  href?: string;
  later?: string;
  active?: boolean;
}

// From which width the tabs sit side by side with icon and name. Below it each tab shows its
// icon with a short name under it, and the row scrolls sideways when there are many tabs, with
// the active tab kept in view. Literal class names, for Tailwind.
const BREAKPOINT = {
  sm: {
    later: "hidden sm:flex",
    row: "sm:gap-1",
    link: "flex-col gap-0.5 px-2 text-[11px] sm:flex-row sm:gap-2 sm:px-3 sm:text-base",
    icon: "size-5 sm:size-6",
  },
  // Tighter, for portals with many tabs (superadmin has nine).
  lg: {
    later: "hidden lg:flex",
    row: "",
    link: "flex-col gap-0.5 px-2 text-[11px] lg:flex-row lg:gap-1 lg:px-1.5 lg:text-[15px]",
    icon: "size-5",
  },
} as const;

export function TabNav({ label, tabs, labelsFrom }: { label: string; tabs: Tab[]; labelsFrom: keyof typeof BREAKPOINT }) {
  const bp = BREAKPOINT[labelsFrom];
  const active = useRef<HTMLAnchorElement>(null);
  const activeHref = tabs.find((t) => t.active)?.href;
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeHref]);
  return (
    <nav aria-label={label} className="mt-3 border-b border-line print:hidden">
      <ul className={`flex overflow-x-auto [scrollbar-width:none] ${bp.row}`}>
        {tabs.map((tab) => (
          <li key={tab.label} className={`${tab.href ? "flex" : bp.later} shrink-0`}>
            {tab.href ? (
              <Link
                href={tab.href}
                ref={tab.active ? active : undefined}
                aria-current={tab.active ? "page" : undefined}
                className={`inline-flex min-h-12 w-full items-center justify-center whitespace-nowrap border-b-2 font-semibold ${bp.link} ${
                  tab.active ? "border-brand text-brand" : "border-transparent text-muted hover:text-fg"
                }`}
              >
                <Icon name={tab.icon} className={`${bp.icon} shrink-0`} />
                <span>{tab.label}</span>
              </Link>
            ) : (
              <span
                title={tab.later}
                className={`inline-flex min-h-12 w-full cursor-not-allowed items-center justify-center whitespace-nowrap border-b-2 border-transparent text-muted opacity-60 ${bp.link}`}
              >
                <Icon name={tab.icon} className={`${bp.icon} shrink-0`} />
                <span>{tab.label}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
