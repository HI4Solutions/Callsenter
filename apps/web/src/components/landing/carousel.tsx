"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { prefersReducedMotion } from "@/components/landing/motion";

// A list of cards that is a grid from `sm` and a sideways swipe row with snap points and dots on
// phones. The cards are the children (CAROUSEL_ITEM on each <li>); `grid` sets the columns from sm.
export const CAROUSEL_ITEM = "w-[82%] flex-none snap-start sm:w-auto";

export function Carousel({ count, grid, children }: { count: number; grid: string; children: React.ReactNode }) {
  const t = useTranslations("landing.carousel");
  const list = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);

  function itemStep(el: HTMLUListElement): number {
    const [first, second] = el.children as HTMLCollectionOf<HTMLElement>;
    return first && second ? second.offsetLeft - first.offsetLeft : el.clientWidth;
  }

  function onScroll() {
    const el = list.current;
    if (!el) return;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    setIndex(atEnd ? count - 1 : Math.round(el.scrollLeft / itemStep(el)));
  }

  function go(n: number) {
    const el = list.current;
    if (!el) return;
    el.scrollTo({ left: n * itemStep(el), behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  return (
    <div>
      <ul
        ref={list}
        onScroll={onScroll}
        data-reveal-group
        className={`no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:overflow-visible sm:px-0 sm:pb-0 ${grid}`}
      >
        {children}
      </ul>
      <div className="mt-3 flex justify-center sm:hidden">
        {Array.from({ length: count }, (_, n) => (
          <button
            key={n}
            type="button"
            onClick={() => go(n)}
            aria-label={t("goTo", { n: n + 1, total: count })}
            aria-current={n === index ? "true" : undefined}
            className="group flex size-6 items-center justify-center"
          >
            <span aria-hidden className="h-2 w-2 rounded-full bg-line transition-all group-aria-[current]:w-5 group-aria-[current]:bg-brand" />
          </button>
        ))}
      </div>
    </div>
  );
}
