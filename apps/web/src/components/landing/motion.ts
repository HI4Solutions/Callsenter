"use client";

import { useEffect, useRef } from "react";

// Small helpers for the landing page's scroll effects (docs/plan.md, section 20). CSS and native
// browser APIs only, no animation library.

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Runs `onFrame` at most once per animation frame while the page scrolls or resizes, and once at
// the start. The callback should only read layout and write to the DOM directly, not set state on
// every frame.
export function useScrollFrame(onFrame: () => void, enabled = true) {
  const callback = useRef(onFrame);
  useEffect(() => {
    callback.current = onFrame;
  });
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        callback.current();
      });
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [enabled]);
}

// Fades sections and cards in as they are scrolled to: [data-reveal] on its own, or every
// [data-reveal] inside a [data-reveal-group] at once (staggered by --i in CSS). The page is only
// marked with data-motion after what is already on screen has been shown, so nothing flickers,
// and without JavaScript, with reduced motion or in print everything is simply there.
export function useReveal(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el || prefersReducedMotion() || typeof IntersectionObserver === "undefined") return;
    const targets = [...el.querySelectorAll<HTMLElement>("[data-reveal-group], [data-reveal]:not([data-reveal-group] [data-reveal])")];
    const show = (target: Element) => {
      const items = target.hasAttribute("data-reveal-group") ? target.querySelectorAll("[data-reveal]") : [target];
      for (const item of items) item.setAttribute("data-shown", "");
    };
    const pending = targets.filter((target) => {
      if (target.getBoundingClientRect().top < window.innerHeight) {
        show(target);
        return false;
      }
      return true;
    });
    el.setAttribute("data-motion", "");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          show(entry.target);
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    for (const target of pending) observer.observe(target);
    return () => {
      observer.disconnect();
      el.removeAttribute("data-motion");
      for (const item of el.querySelectorAll("[data-shown]")) item.removeAttribute("data-shown");
    };
  }, [root]);
}

// True once the element with this id has been scrolled up past the top of the screen.
export function scrolledPast(id: string): boolean {
  const el = document.getElementById(id);
  return !!el && el.getBoundingClientRect().bottom < 0;
}

// True once the top of the element with this id is on screen (or above it).
export function reached(id: string, margin = 0): boolean {
  const el = document.getElementById(id);
  return !!el && el.getBoundingClientRect().top < window.innerHeight - margin;
}
