// Modules a superadmin switches on and off per call centre (organization_modules). The keys
// are stored in the database; the labels are shown in the superadmin portal. docs/plan.md,
// section 1 lists the modules.
export const MODULES = {
  sales: { name: "Kunder, produkter og salg", description: "Kunder, selgere, produkter, salg og status med kundehistorikk." },
  product_templates: { name: "Produktmaler", description: "Pris, vilkår, godkjente formuleringer og regler per produkt." },
  transcription: { name: "Transkribering", description: "Tale til tekst med Soniox, søk og kobling mellom lyd og tekst." },
  reports: { name: "Rapporter", description: "Rapport etter hver samtale, med rapportmaler." },
  ai_control: { name: "AI-kontroll", description: "Samtalen sjekkes mot produktmalen og flagges grønn, gul eller rød." },
  sale_verification: { name: "Salgsverifisering", description: "Kunden godtar kjøpet med BankID eller Vipps. Tilleggsmodul med kostnad per aksept." },
  documentation: { name: "Dokumentasjon", description: "Salgssammendrag av hva som ble sagt, tilbudt og akseptert." },
  complaints: { name: "Klagehåndtering", description: "Samlet dokumentasjon for klagesaker." },
  dashboard: { name: "Dashboard og coaching", description: "Salg, kvalitet, avvik og tilbakemeldinger til selgere." },
} as const satisfies Record<string, { name: string; description: string }>;

export type ModuleKey = keyof typeof MODULES;

export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === "string" && Object.hasOwn(MODULES, value);
}
