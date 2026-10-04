import { useTranslations } from "next-intl";

export const DEMO_HREF = "#kontakt";

// "Be om en demo": the page's most important button. A glow in the brand colour, a small lift and
// an arrow that slides on hover or press (globals.css, .cta-glow). `pulse` adds two soft rings
// shortly after the page has loaded, for the one in the hero.
export function DemoLink({ className = "", pulse = false, tabIndex }: { className?: string; pulse?: boolean; tabIndex?: number }) {
  const t = useTranslations("landing.hero");
  return (
    <a
      href={DEMO_HREF}
      tabIndex={tabIndex}
      className={`cta-glow ${pulse ? "cta-pulse" : ""} inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand px-5 font-semibold text-on-brand ${className}`}
    >
      {t("demo")}
      <Arrow />
    </a>
  );
}

export function Arrow() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="cta-arrow size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10h11M11 5.5 15.5 10 11 14.5" />
    </svg>
  );
}
