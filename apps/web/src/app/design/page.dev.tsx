// Design system reference for us while building. A .dev.tsx page: next.config.ts only builds it
// in development, so on staging and production /design does not exist.
import type { Metadata } from "next";
import { Flag } from "@/components/flag";
import { derived, palette } from "@/lib/tokens";

export const metadata: Metadata = {
  title: "Designsystem",
  robots: { index: false },
};

const brandSwatches: { name: string; hex: string; use: string }[] = [
  { name: "Stempel", hex: palette.stamp, use: "Merkefarge, lys modus" },
  { name: "Stempel lys", hex: palette.stampLight, use: "Merkefarge, mørk modus" },
  { name: "Skrift", hex: palette.ink, use: "Tekst, lys modus" },
  { name: "Papir", hex: palette.paper, use: "Bakgrunn, lys modus" },
  { name: "Natt", hex: palette.night, use: "Bakgrunn, mørk modus" },
  { name: "Tåke", hex: palette.mist, use: "Tekst, mørk modus" },
];

const flagSwatches: { name: string; hex: string; use: string }[] = [
  { name: "Godkjent", hex: palette.approved, use: "Bare grønt AI-flagg" },
  { name: "Avvik", hex: palette.deviation, use: "Bare gult AI-flagg" },
  { name: "Brudd", hex: palette.violation, use: "Bare rødt AI-flagg" },
];

function Swatches({ items }: { items: typeof brandSwatches }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map(({ name, hex, use }) => (
        <li key={name} className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="h-16 border-b border-line" style={{ background: hex }} />
          <div className="p-3">
            <p className="font-semibold">{name}</p>
            <p className="font-mono text-sm text-muted">{hex}</p>
            <p className="mt-1 text-sm text-muted">{use}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="mb-4 text-2xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

export default function DesignPage() {
  return (
    <>
      <h1 className="text-4xl font-extrabold tracking-tight">Designsystem</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Fargene, typografien og komponentene alle skjermer bygges av. Bytt modus øverst for å se lys og mørk
        versjon. Siden tilpasser seg mobil, nettbrett og desktop.
      </p>

      <Section title="Merkefarger">
        <Swatches items={brandSwatches} />
      </Section>

      <Section title="AI-flagg">
        <p className="mb-4 max-w-2xl text-muted">
          Grønn, gul og rød er reservert for AI-flagg og status. De brukes aldri som pynt, og betydningen står
          alltid som tekst i tillegg til fargen.
        </p>
        <div className="mb-4 flex flex-wrap gap-3">
          <Flag level="approved" />
          <Flag level="deviation" />
          <Flag level="violation" />
        </div>
        <Swatches items={flagSwatches} />
      </Section>

      <Section title="Typografi">
        <div className="rounded-lg border border-line bg-surface p-5">
          <p className="text-4xl font-extrabold tracking-tight">Schibsted Grotesk 800</p>
          <p className="mt-3 text-xl font-semibold">Overskrift i vekt 600</p>
          <p className="mt-2">Brødtekst i vekt 400. Alle brukertekster er på norsk bokmål.</p>
          <p className="mt-2 text-sm text-muted">Dempet hjelpetekst. Kontrast mot flaten er minst 4,5:1.</p>
        </div>
      </Section>

      <Section title="Knapper og felt">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="min-h-11 rounded-lg bg-brand px-5 font-semibold text-on-brand">
            Primærknapp
          </button>
          <button type="button" className="min-h-11 rounded-lg border border-line bg-surface px-5 font-semibold">
            Sekundærknapp
          </button>
          <label className="flex min-w-60 flex-1 flex-col gap-1 text-sm font-medium">
            Søk i samtaler
            <input
              type="search"
              placeholder="Skriv for å søke"
              className="min-h-11 rounded-lg border border-line bg-surface px-3 text-base font-normal placeholder:text-muted"
            />
          </label>
        </div>
      </Section>

      <Section title="Responsivt rutenett">
        <p className="mb-4 text-muted">Ett kort per rad på mobil, to på nettbrett og tre på desktop.</p>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {["Samtaler", "Salg", "Avvik", "Klager", "Coaching", "Rapporter"].map((title) => (
            <li key={title} className="rounded-lg border border-line bg-surface p-4">
              <p className="font-semibold">{title}</p>
              <p className="mt-1 text-sm text-muted">Eksempelkort</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Avledede flater">
        <p className="text-sm text-muted">
          Flate, kant og dempet tekst er ikke i merkepaletten, men utledet:{" "}
          <span className="font-mono">
            lys {derived.light.surface} / {derived.light.border} / {derived.light.muted}
          </span>
          ,{" "}
          <span className="font-mono">
            mørk {derived.dark.surface} / {derived.dark.border} / {derived.dark.muted}
          </span>
          .
        </p>
      </Section>
    </>
  );
}
