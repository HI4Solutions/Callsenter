"use client";

import { LOCALE_CODES, LOCALES } from "@veriqall/shared";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ContactForm } from "@/components/landing/contact-form";
import { LandingJsonLd } from "@/components/landing/landing-json-ld";
import { Flag, type FlagLevel } from "@/components/flag";
import { LanguagePicker } from "@/components/language-picker";

const primaryButton = "inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-5 font-semibold text-on-brand";
const secondaryButton = "inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-surface px-5 font-semibold";
const card = "rounded-xl border border-line bg-surface p-5";
// A soft tint of the brand colour, for the hero, the languages and the closing call to action.
const tint = "bg-[color-mix(in_srgb,var(--brand)_7%,var(--surface))]";

// The public front page (docs/plan.md, section 20). A client component, so the superadmin preview
// can render it only after access is confirmed. Everything a visitor sees comes from the
// landing namespace; the product mock in the hero is built from the app's own Flag component, so
// green, yellow and red mean what they mean in the app.
export function LandingPage() {
  const tm = useTranslations("landing.meta");
  // "Be om en demo" scrolls to the contact form at the bottom.
  const demoHref = "#kontakt";
  return (
    <div className="flex flex-col gap-20 sm:gap-24">
      <LandingJsonLd description={tm("description")} />
      <Hero demoHref={demoHref} />
      <Why />
      <How />
      <Features />
      <Roles />
      <Trust />
      <Languages />
      <Pricing demoHref={demoHref} />
      <Faq />
      <Contact />
      <Footer />
    </div>
  );
}

function Section({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">{title}</h2>
      {intro && <p className="mt-3 max-w-2xl text-lg text-muted">{intro}</p>}
      <div className="mt-8">{children}</div>
    </section>
  );
}

function Hero({ demoHref }: { demoHref: string }) {
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
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={demoHref} className={primaryButton}>
              {t("demo")}
            </a>
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

// A still of the AI control during a call: the lamps per required point, the lines of the
// transcript the yellow one points at, and the customer's acceptance.
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
  return (
    <figure className="min-w-0">
      <div className="rounded-xl border border-line bg-surface p-4 shadow-lg shadow-black/5 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold">{t("title")}</p>
          <Flag level="deviation" />
        </div>
        <p className="mt-1 text-sm text-muted">
          {t("template")} · {t("reference")}
        </p>
        <ul className="mt-4 flex flex-col gap-2">
          {points.map((p) => (
            <li key={p.key} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Flag level={p.level} />
                <span className="min-w-0 text-sm font-semibold">{t(p.key)}</span>
              </div>
              {p.note && <p className="mt-1 text-sm text-muted">{t(p.note)}</p>}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm font-semibold">{t("transcriptTitle")}</p>
        <ol className="mt-2 flex flex-col gap-1 text-sm">
          {lines.map((l) => (
            <li key={l.key} className={`rounded-lg px-2 py-1.5 ${l.marked ? "bg-bg ring-1 ring-line" : ""}`}>
              <span className="font-mono text-xs text-muted">{l.time}</span> <span className="font-semibold">{t(l.who)}:</span> {t(l.key)}
            </li>
          ))}
        </ol>
        <p className="mt-4 flex items-start gap-2 border-t border-line pt-3 text-sm">
          <span aria-hidden className="mt-1.5 size-2 flex-none rounded-full bg-brand" />
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
      <ul className="grid gap-4 sm:grid-cols-3">
        {([1, 2, 3] as const).map((n) => (
          <li key={n} className={card}>
            <h3 className="text-lg font-semibold">{t(`item${n}Title`)}</h3>
            <p className="mt-2 text-muted">{t(`item${n}`)}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function How() {
  const t = useTranslations("landing.how");
  return (
    <Section title={t("title")}>
      <ol className="flex max-w-3xl flex-col gap-8">
        {([1, 2, 3, 4, 5] as const).map((n) => (
          <li key={n} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-4 sm:grid-cols-[3.5rem_minmax(0,1fr)]">
            <span aria-hidden className="text-4xl leading-none font-extrabold text-brand sm:text-5xl">
              {n}
            </span>
            <div>
              <h3 className="text-xl font-semibold">{t(`step${n}Title`)}</h3>
              <p className="mt-2 text-muted">{t(`step${n}`)}</p>
              {n === 4 && <p className="mt-2 text-sm text-muted">{t("step4Note")}</p>}
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Features() {
  const t = useTranslations("landing.features");
  return (
    <Section title={t("title")} intro={t("intro")}>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {([1, 2, 3, 4, 5, 6, 7, 8] as const).map((n) => (
          <li key={n} className={card}>
            <h3 className="font-semibold">{t(`f${n}Title`)}</h3>
            <p className="mt-2 text-sm text-muted">{t(`f${n}`)}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Roles() {
  const t = useTranslations("landing.roles");
  return (
    <Section title={t("title")}>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {([1, 2, 3, 4] as const).map((n) => (
          <li key={n} className={card}>
            <h3 className="text-lg font-semibold">{t(`r${n}Title`)}</h3>
            <p className="mt-2 text-muted">{t(`r${n}`)}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Trust() {
  const t = useTranslations("landing.trust");
  return (
    <Section title={t("title")} intro={t("intro")}>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {([1, 2, 3, 4, 5, 6] as const).map((n) => (
          <li key={n} className={card}>
            <h3 className="font-semibold">{t(`t${n}Title`)}</h3>
            <p className="mt-2 text-sm text-muted">{t(`t${n}`)}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Languages() {
  const t = useTranslations("landing.languages");
  return (
    <section className={`rounded-2xl border border-line ${tint} p-6 sm:p-10`}>
      <h2 className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">{t("title")}</h2>
      <p className="mt-3 max-w-3xl text-lg text-muted">{t("text")}</p>
      <ul className="mt-6 flex flex-wrap gap-2">
        {LOCALE_CODES.map((code) => (
          <li key={code} lang={LOCALES[code].tag} className="rounded-full border border-line bg-surface px-3 py-1 text-sm font-medium">
            {LOCALES[code].name}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Pricing({ demoHref }: { demoHref: string }) {
  const t = useTranslations("landing.pricing");
  return (
    <Section title={t("title")} intro={t("intro")}>
      <ul className="grid gap-4 sm:grid-cols-3">
        {([1, 2, 3] as const).map((n) => (
          <li key={n} className={card}>
            <h3 className="text-lg font-semibold">{t(`p${n}Title`)}</h3>
            <p className="mt-2 text-muted">{t(`p${n}`)}</p>
          </li>
        ))}
      </ul>
      <div className="mt-6">
        <a href={demoHref} className={secondaryButton}>
          {t("cta")}
        </a>
      </div>
    </Section>
  );
}

function Faq() {
  const t = useTranslations("landing.faq");
  return (
    <Section title={t("title")}>
      <div className="flex max-w-3xl flex-col gap-3">
        {([1, 2, 3, 4, 5, 6] as const).map((n) => (
          <details key={n} className="group rounded-xl border border-line bg-surface">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 font-semibold [&::-webkit-details-marker]:hidden">
              {t(`q${n}`)}
              <span aria-hidden className="text-xl leading-none text-brand transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="px-5 pb-4 text-muted">{t(`a${n}`)}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

function Contact() {
  const t = useTranslations("landing.contact");
  return (
    <section id="kontakt" className={`scroll-mt-24 rounded-2xl border border-line ${tint} p-6 sm:p-10`}>
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
