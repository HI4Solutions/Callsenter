"use client";

import { useRef } from "react";
import { useScrollFrame } from "@/components/landing/motion";

// A thin bar in the brand colour across the very top that shows how far down the page the visitor
// is. Decoration only, so it is hidden from screen readers.
export function ScrollProgress() {
  const bar = useRef<HTMLDivElement>(null);
  useScrollFrame(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.current?.style.setProperty("transform", `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`);
  });
  return <div ref={bar} aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px] origin-left scale-x-0 bg-brand print:hidden" />;
}
