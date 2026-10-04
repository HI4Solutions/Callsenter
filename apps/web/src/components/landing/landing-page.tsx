"use client";

import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Carousel, CAROUSEL_ITEM } from "@/components/landing/carousel";
import { ChatBubble } from "@/components/landing/chat-bubble";
import { ContactForm } from "@/components/landing/contact-form";
import { DemoLink } from "@/components/landing/demo-link";
import { LandingJsonLd } from "@/components/landing/landing-json-ld";
import { MobileCta } from "@/components/landing/mobile-cta";
import { prefersReducedMotion, useReveal, useScrollFrame } from "@/components/landing/motion";
import { ScrollProgress } from "@/components/landing/scroll-progress";
import { SectionNav } from "@/components/landing/section-nav";
import { Flag, type FlagLevel } from "@/components/flag";
import { LanguagePicker } from "@/components/language-picker";

const secondaryButton = "inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-surface px-5 font-semibold";
const card = "rounded-xl border border-line bg-surface p-5";
// A soft tint of the brand colour, for the hero, the calls to action and the contact form.
const tint = "bg-[color-mix(in_srgb,var(--brand)_7%,var(--surface))]";

// The public front page (docs/plan.md, section 20). A client component, so the superadmin preview
// can render it only after access is confirmed. Everything a visitor sees comes from the
// landing namespace; the product mock in the hero is built from the app's own Flag component, so
// green, yellow and red mean what they mean in the app.
export function LandingPage() {
  const tm = useTranslations("landing.meta");
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);

  // The section menu sticks right under the app's header, whatever its height.
  useEffect(() => {
    const header = document.querySelector<HTMLElement>("body > header");
    const el = root.current;
    if (!header || !el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => el.style.setProperty("--landing-header", `${header.offsetHeight}px`));
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={root} data-landing className="flex flex-col gap-20 sm:gap-24">
      <LandingJsonLd description={tm("description")} />
      <ScrollProgress />
      <SectionNav />
      <Hero />
      <Why />
      <How />
      <Features />
      <Roles />
      <Trust />
      <Faq />
      <Contact />
      <ChatBubble />
      <MobileCta />
      <Footer />
    </div>
  );
}

// The index of a card in its list, for the staggered fade-in (globals.css, [data-reveal]).
function stagger(i: number): React.CSSProperties {
  return { "--i": i } as React.CSSProperties;
}

function Section({ id, title, intro, children }: { id?: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section id={id}>
      <div data-reveal>
        <h2 className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">{title}</h2>
        {intro && <p className="mt-3 max-w-2xl text-lg text-muted">{intro}</p>}
      </div>
      <div className="mt-8">{children}</div>
    </section>
  );
}

// A short line and "Be om en demo", between sections, so the next step is never far away.
function CtaBand({ text }: { text: string }) {
  return (
    <div data-reveal className={`flex flex-col items-start gap-4 rounded-2xl border border-line ${tint} p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8`}>
      <p className="max-w-xl text-lg font-semibold text-balance">{text}</p>
      <DemoLink className="flex-none" />
    </div>
  );
}

function Hero() {
  const t = useTranslations("landing.hero");
  const symbol = "pointer-events-none absolute -top-24 -right-20 w-80 opacity-[0.06] sm:w-[30rem]";
  return (
    <section className={`relative overflow-hidden rounded-2xl border border-line ${tint} p-6 sm:p-10 lg:p-14`}>
      {/* The Q from the logo, faint, is the only decoration. Both variants; the theme picks one. */}
      <Image src="/brand/veriqall-symbol-light.svg" alt="" aria-hidden width={480} height={480} unoptimized className={`logo-light ${symbol}`} />
      <Image src="/brand/veriqall-symbol-dark.svg" alt="" aria-hidden width={480} height={480} unoptimized className={`logo-dark ${symbol}`} />
      <div className="relative grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center">
        <div>
          <p className="text-sm font-semibold tracking-wide text-brand uppercase">{t("eyebrow")}</p>
          <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-balance sm:text-5xl lg:text-6xl">{t("title")}</h1>
          <p className="mt-5 max-w-xl text-lg text-muted">{t("lead")}</p>
          <div id="hero-cta" className="mt-8 flex flex-wrap gap-3">
            <DemoLink pulse />
            <Link href="/logg-inn" className={secondaryButton}>
              {t("login")}
            </Link>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
            {(["fact1", "fact2", "fact3"] as const).map((key) => (
              <li key={key} className="flex items-center gap-2">
                <span aria-hidden className="size-1.5 rounded-full bg-brand" />
                {t(key)}
              </li>
            ))}
          </ul>
        </div>
        <ProductDemo />
      </div>
    </section>
  );
}

// The AI control during a call: the lamps per required point light up one by one, the lines of the
// transcript the yellow one points at come in, and last the customer's acceptance. Played once
// once, in CSS (globals.css, .demo-in and .demo-lamp, delays in --d), so it ends as a still and
// is a still with reduced motion. It waits (data-demo="wait") until most of the card is on
// screen, so on a phone, where it sits below the hero text, it plays when the visitor scrolls
// to it. Green, yellow and red stay AI flags.
function ProductDemo() {
  const t = useTranslations("landing.demo");
  const points: { key: "point1" | "point2" | "point3" | "point4"; level: FlagLevel; note?: "point3Note" }[] = [
    { key: "point1", level: "approved" },
    { key: "point2", level: "approved" },
    { key: "point3", level: "deviation", note: "point3Note" },
    { key: "point4", level: "approved" },
  ];
  const lines: { time: string; who: "seller" | "customer"; key: "line1" | "line2" | "line3"; marked?: boolean }[] = [
    { time: "03:58", who: "seller", key: "line1" },
    { time: "04:05", who: "customer", key: "line2" },
    { time: "04:12", who: "seller", key: "line3", marked: true },
  ];
  const delay = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;
  const figure = useRef<HTMLElement>(null);
  const [waiting, setWaiting] = useState(true);
  useEffect(() => {
    const el = figure.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setWaiting(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setWaiting(false);
        observer.disconnect();
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <figure ref={figure} data-demo={waiting ? "wait" : undefined} className="min-w-0">
      <div className="demo-in rounded-xl border border-line bg-surface p-4 shadow-lg shadow-black/5 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold">{t("title")}</p>
          <span className="demo-lamp" style={delay(1500)}>
            <Flag level="deviation" />
          </span>
        </div>
        <p className="mt-1 text-sm text-muted">
          {t("template")} · {t("reference")}
        </p>
        <ul className="mt-4 flex flex-col gap-2">
          {points.map((p, i) => (
            <li key={p.key} className="demo-in rounded-lg border border-line p-3" style={delay(150 + i * 80)}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="demo-lamp" style={delay(600 + i * 400)}>
                  <Flag level={p.level} />
                </span>
                <span className="min-w-0 text-sm font-semibold">{t(p.key)}</span>
              </div>
              {p.note && (
                <p className="demo-in mt-1 text-sm text-muted" style={delay(600 + i * 400 + 250)}>
                  {t(p.note)}
                </p>
              )}
            </li>
          ))}
        </ul>
        <p className="demo-in mt-4 text-sm font-semibold" style={delay(2200)}>
          {t("transcriptTitle")}
        </p>
        <ol className="mt-2 flex flex-col gap-1 text-sm">
          {lines.map((l, i) => (
            <li
              key={l.key}
              className={`demo-in rounded-lg px-2 py-1.5 ${l.marked ? "demo-mark bg-bg ring-1 ring-line" : ""}`}
              style={delay(2400 + i * 450)}
            >
              <span className="font-mono text-xs text-muted">{l.time}</span> <span className="font-semibold">{t(l.who)}:</span> {t(l.key)}
            </li>
          ))}
        </ol>
        <p className="demo-in mt-4 flex items-start gap-2 border-t border-line pt-3 text-sm" style={delay(3900)}>
          <svg aria-hidden viewBox="0 0 20 20" className="demo-check mt-0.5 size-4 flex-none text-brand" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="10" cy="10" r="8.5" strokeWidth="1.8" pathLength={1} />
            <path d="m6.2 10.3 2.6 2.6 5-5.2" pathLength={1} />
          </svg>
          {t("confirmation")}
        </p>
      </div>
      <figcaption className="mt-3 text-center text-sm text-muted">{t("caption")}</figcaption>
    </figure>
  );
}

function Why() {
  const t = useTranslations("landing.why");
  return (
    <Section title={t("title")}>
      <ul data-reveal-group className="grid gap-4 sm:grid-cols-3">
        {([1, 2, 3] as const).map((n) => (
          <li key={n} data-reveal style={stagger(n - 1)} className={card}>
            <h3 className="text-lg font-semibold">{t(`item${n}Title`)}</h3>
            <p className="mt-2 text-muted">{t(`item${n}`)}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// The five steps as a timeline: the line between the numbers fills with the brand colour as the
// visitor scrolls, and each number fills when the line reaches it. Written straight to the DOM
// once per frame. Without JavaScript or with reduced motion, the line is simply full.
function How() {
  const t = useTranslations("landing.how");
  const tc = useTranslations("landing.cta");
  const list = useRef<HTMLOListElement>(null);
  useScrollFrame(() => {
    const el = list.current;
    if (!el) return;
    const reduce = prefersReducedMotion();
    // The track runs from the first number's centre to the last one's; 22 px is half a number.
    const steps = [...el.querySelectorAll<HTMLElement>("[data-step]")];
    const first = steps[0];
    const last = steps[steps.length - 1];
    if (!first || !last) return;
    const start = first.offsetTop + 22;
    const end = last.offsetTop + 22;
    el.style.setProperty("--track-top", `${start}px`);
    el.style.setProperty("--track-height", `${end - start}px`);
    const line = window.innerHeight * 0.6;
    const top = el.getBoundingClientRect().top;
    el.style.setProperty("--progress", reduce ? "1" : String(Math.min(1, Math.max(0, (line - top - start) / (end - start)))));
    for (const step of steps) step.toggleAttribute("data-reached", reduce || top + step.offsetTop + 22 <= line);
  });
  return (
    <div className="flex flex-col gap-10">
      <Section id="slik-virker-det" title={t("title")}>
        <ol ref={list} className="timeline relative flex max-w-3xl flex-col gap-10">
          <span aria-hidden className="timeline-track" />
          {([1, 2, 3, 4, 5] as const).map((n) => (
            <li key={n} data-step data-reached data-reveal className="relative grid grid-cols-[2.75rem_minmax(0,1fr)] gap-4 sm:gap-5">
              <span aria-hidden className="timeline-dot">
                {n}
              </span>
              <div className="pt-1.5">
                <h3 className="text-xl font-semibold">{t(`step${n}Title`)}</h3>
                <p className="mt-2 text-muted">{t(`step${n}`)}</p>
                {n === 4 && <p className="mt-2 text-sm text-muted">{t("step4Note")}</p>}
              </div>
            </li>
          ))}
        </ol>
      </Section>
      <CtaBand text={tc("afterHow")} />
    </div>
  );
}

function Features() {
  const t = useTranslations("landing.features");
  return (
    <Section id="funksjoner" title={t("title")} intro={t("intro")}>
      <Carousel count={8} grid="sm:grid-cols-2 lg:grid-cols-4">
        {([1, 2, 3, 4, 5, 6, 7, 8] as const).map((n) => (
          <li key={n} data-reveal style={stagger(n - 1)} className={`${card} ${CAROUSEL_ITEM}`}>
            <h3 className="font-semibold">{t(`f${n}Title`)}</h3>
            <p className="mt-2 text-sm text-muted">{t(`f${n}`)}</p>
          </li>
        ))}
      </Carousel>
    </Section>
  );
}

function Roles() {
  const t = useTranslations("landing.roles");
  return (
    <Section title={t("title")}>
      <Carousel count={4} grid="sm:grid-cols-2 lg:grid-cols-4">
        {([1, 2, 3, 4] as const).map((n) => (
          <li key={n} data-reveal style={stagger(n - 1)} className={`${card} ${CAROUSEL_ITEM}`}>
            <h3 className="text-lg font-semibold">{t(`r${n}Title`)}</h3>
            <p className="mt-2 text-muted">{t(`r${n}`)}</p>
          </li>
        ))}
      </Carousel>
    </Section>
  );
}

function Trust() {
  const t = useTranslations("landing.trust");
  const tc = useTranslations("landing.cta");
  return (
    <div className="flex flex-col gap-10">
      <Section title={t("title")} intro={t("intro")}>
        <Carousel count={6} grid="sm:grid-cols-2 lg:grid-cols-3">
          {([1, 2, 3, 4, 5, 6] as const).map((n) => (
            <li key={n} data-reveal style={stagger(n - 1)} className={`${card} ${CAROUSEL_ITEM}`}>
              <h3 className="font-semibold">{t(`t${n}Title`)}</h3>
              <p className="mt-2 text-sm text-muted">{t(`t${n}`)}</p>
            </li>
          ))}
        </Carousel>
      </Section>
      <CtaBand text={tc("afterTrust")} />
    </div>
  );
}

// One answer open at a time: the details share a name (an exclusive accordion in the browser).
// The answer slides open where the browser can animate to auto height (globals.css, .faq).
function Faq() {
  const t = useTranslations("landing.faq");
  return (
    <Section id="sporsmal" title={t("title")}>
      <div data-reveal-group className="flex max-w-3xl flex-col gap-3">
        {([1, 2, 3, 4, 5, 6] as const).map((n) => (
          <details key={n} name="faq" data-reveal style={stagger(n - 1)} className="faq group rounded-xl border border-line bg-surface transition-colors open:border-brand/40">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-5 py-3 font-semibold [&::-webkit-details-marker]:hidden">
              {t(`q${n}`)}
              <span aria-hidden className="flex size-7 flex-none items-center justify-center rounded-full text-xl leading-none text-brand transition-[transform,background-color] duration-300 group-open:rotate-45 group-open:bg-[color-mix(in_srgb,var(--brand)_12%,var(--surface))]">
                +
              </span>
            </summary>
            <p className="faq-answer px-5 pb-4 text-muted">{t(`a${n}`)}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

function Contact() {
  const t = useTranslations("landing.contact");
  return (
    <section id="kontakt" className={`rounded-2xl border border-line ${tint} p-6 sm:p-10`}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">{t("title")}</h2>
          <p className="mt-3 text-lg text-muted">{t("intro")}</p>
        </div>
        <ContactForm />
      </div>
    </section>
  );
}

function Footer() {
  const t = useTranslations("landing.footer");
  return (
    <footer className="flex flex-col gap-4 border-t border-line pt-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <p>{t("provider")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/logg-inn" className="inline-flex min-h-11 items-center font-semibold text-fg">
          {t("login")}
        </Link>
        <LanguagePicker signedIn={false} />
      </div>
    </footer>
  );
}
