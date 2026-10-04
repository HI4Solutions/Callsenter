"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { DemoLink } from "@/components/landing/demo-link";
import { prefersReducedMotion, scrolledPast, useScrollFrame } from "@/components/landing/motion";

// The sections the menu links to, in page order. The ids are fixed anchors, not translated.
export const SECTIONS = [
  { id: "slik-virker-det", key: "how" },
  { id: "funksjoner", key: "features" },
  { id: "sporsmal", key: "faq" },
  { id: "kontakt", key: "contact" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

// The menu under the header that stays at the top while scrolling. The section on screen is marked
// (aria-current), and on a phone the row can be swiped sideways and follows along. Once the hero's
// buttons are scrolled away, "Be om en demo" appears on the right (not on phones, which have their
// own bar at the bottom).
export function SectionNav() {
  const t = useTranslations("landing.nav");
  const [active, setActive] = useState<SectionId | null>(null);
  const [showDemo, setShowDemo] = useState(false);
  const row = useRef<HTMLUListElement>(null);

  useScrollFrame(() => {
    setShowDemo(scrolledPast("hero-cta"));
    // The section whose top is above a line 40 % down the screen; at the very bottom, the last one.
    const line = window.innerHeight * 0.4;
    let current: SectionId | null = null;
    for (const { id } of SECTIONS) {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top <= line) current = id;
    }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = "kontakt";
    setActive(current);
  });

  // Keep the active link in view in the row on narrow screens, without scrolling the page.
  useEffect(() => {
    const list = row.current;
    const link = active && list?.querySelector<HTMLElement>(`a[href="#${active}"]`);
    if (!list || !link || list.scrollWidth <= list.clientWidth) return;
    list.scrollTo({ left: link.offsetLeft - 16, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [active]);

  return (
    <nav aria-label={t("label")} className="landing-nav sticky z-20 -mx-4 -mt-10 -mb-12 bg-surface px-4 sm:-mx-6 sm:-mt-16 sm:-mb-16 sm:px-6 print:hidden">
      <div className="flex items-center gap-3">
        <ul ref={row} className="no-scrollbar -mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 py-2">
          {SECTIONS.map(({ id, key }) => (
            <li key={id} className="flex-none">
              <a
                href={`#${id}`}
                aria-current={active === id ? "true" : undefined}
                className="inline-flex min-h-10 items-center rounded-full px-3 text-sm font-semibold whitespace-nowrap text-muted transition-colors hover:text-fg aria-[current]:bg-[color-mix(in_srgb,var(--brand)_12%,var(--surface))] aria-[current]:text-brand"
              >
                {t(key)}
              </a>
            </li>
          ))}
        </ul>
        <div
          inert={!showDemo}
          className={`hidden flex-none transition-[opacity,transform] duration-300 motion-reduce:transition-none sm:block ${showDemo ? "opacity-100" : "pointer-events-none translate-x-2 opacity-0"}`}
        >
          <DemoLink className="min-h-9 px-4 text-sm" />
        </div>
      </div>
    </nav>
  );
}
