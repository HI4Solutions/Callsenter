// Fargepaletten fra docs/plan.md, seksjon 6. Samme verdier ligger som
// CSS-variabler i globals.css; tokens.test.ts passer på at de ikke glir fra hverandre.
export const palette = {
  stempel: "#3326C9", // merkefarge, lys modus
  stempelLys: "#A39BFF", // merkefarge, mørk modus
  skrift: "#15172E", // tekst, lys modus
  papir: "#FAFAFC", // bakgrunn, lys modus
  natt: "#10122A", // bakgrunn, mørk modus
  take: "#ECECF6", // tekst, mørk modus (Tåke)
  godkjent: "#1E9E5A", // bare grønt AI-flagg
  avvik: "#E0A100", // bare gult AI-flagg
  brudd: "#D7382F", // bare rødt AI-flagg
} as const;

// Avledede flater som ikke står i planen, men som må tåle kontrastkravene.
export const derived = {
  light: { surface: "#FFFFFF", border: "#DCDCEC", muted: "#555873" },
  dark: { surface: "#181B3A", border: "#2C2F58", muted: "#A9ABC9" },
} as const;
