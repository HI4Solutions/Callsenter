"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

// A round button in the bottom right corner of the landing page that takes the visitor to the
// contact form (#kontakt). It hides while the form is on screen, so it never covers it.
export function ChatBubble() {
  const t = useTranslations("landing.contact");
  const [formVisible, setFormVisible] = useState(false);

  useEffect(() => {
    const form = document.getElementById("kontakt");
    if (!form || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setFormVisible(entry?.isIntersecting ?? false), { threshold: 0.15 });
    observer.observe(form);
    return () => observer.disconnect();
  }, []);

  function open(event: React.MouseEvent<HTMLAnchorElement>) {
    const form = document.getElementById("kontakt");
    if (!form) return;
    event.preventDefault();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    form.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    // Straight into the first field, so the visitor can start writing.
    window.setTimeout(() => form.querySelector<HTMLInputElement>("input[name=name]")?.focus({ preventScroll: true }), reduce ? 0 : 500);
    history.replaceState(null, "", "#kontakt");
  }

  return (
    <a
      href="#kontakt"
      onClick={open}
      aria-label={t("bubble")}
      title={t("bubble")}
      tabIndex={formVisible ? -1 : 0}
      aria-hidden={formVisible}
      className={`fixed right-4 bottom-4 z-40 flex size-14 items-center justify-center rounded-full bg-brand text-on-brand shadow-lg shadow-black/20 transition-[opacity,transform] duration-200 hover:scale-105 sm:right-6 sm:bottom-6 sm:size-16 print:hidden ${
        formVisible ? "pointer-events-none translate-y-2 opacity-0" : "opacity-100"
      }`}
    >
      {/* A speech bubble. */}
      <svg aria-hidden viewBox="0 0 24 24" className="size-7 sm:size-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5.1A8 8 0 1 1 21 12Z" />
        <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" strokeWidth="2.6" />
      </svg>
    </a>
  );
}
