// Texts the API and the worker write themselves, in every language (docs/plan.md, section 19).
// The pages have their own messages in apps/web/messages/. A new language in
// packages/shared/src/locales.ts needs its entry here; the type makes it required.
import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale, MAX_TRANSCRIPTION_LANGUAGES, SONIOX_LANGUAGE } from "@veriqall/shared";
import { BadRequest, type Body } from "../admin/validate.ts";

interface WorkerTexts {
  // The AI control's comment on a required point the model left out.
  pointNotChecked: string;
  // VeriQall's built-in note, when the call centre has no default note template.
  defaultReportName: string;
  defaultReportInstructions: string;
}

export const WORKER_TEXTS: Record<Locale, WorkerTexts> = {
  nb: {
    pointNotChecked: "AI-kontrollen vurderte ikke dette punktet. Sjekk samtalen selv.",
    defaultReportName: "Standardnotat",
    defaultReportInstructions: `Skriv et kort notat om samtalen for callsenterets ledere og compliance:
1. Sammendrag (2–4 setninger): hvem ringte, hva ble tilbudt, og hva endte samtalen med.
2. Tilbud og vilkår: pris, bindingstid og angrerett slik selgeren la dem fram.
3. Kundens svar: aksepterte kunden, og hvordan.
4. Oppfølging: konkrete ting som må følges opp.`,
  },
  en: {
    pointNotChecked: "The AI control did not assess this point. Check the call yourself.",
    defaultReportName: "Standard note",
    defaultReportInstructions: `Write a short note about the call for the call centre's managers and compliance:
1. Summary (2–4 sentences): who called, what was offered, and how the call ended.
2. Offer and terms: price, binding period and right of withdrawal as the seller presented them.
3. The customer's answer: did the customer accept, and how.
4. Follow-up: specific things that need to be followed up.`,
  },
  sv: {
    pointNotChecked: "AI-kontrollen bedömde inte den här punkten. Kontrollera samtalet själv.",
    defaultReportName: "Standardanteckning",
    defaultReportInstructions: `Skriv en kort anteckning om samtalet för callcentrets chefer och compliance:
1. Sammanfattning (2–4 meningar): vem ringde, vad erbjöds och hur slutade samtalet.
2. Erbjudande och villkor: pris, bindningstid och ångerrätt så som säljaren presenterade dem.
3. Kundens svar: accepterade kunden, och hur.
4. Uppföljning: konkreta saker som behöver följas upp.`,
  },
  da: {
    pointNotChecked: "AI-kontrollen vurderede ikke dette punkt. Tjek selv samtalen.",
    defaultReportName: "Standardnotat",
    defaultReportInstructions: `Skriv et kort notat om samtalen til callcentrets ledere og compliance:
1. Resumé (2–4 sætninger): hvem ringede, hvad blev tilbudt, og hvordan endte samtalen.
2. Tilbud og vilkår: pris, bindingsperiode og fortrydelsesret, som sælgeren præsenterede dem.
3. Kundens svar: accepterede kunden, og hvordan.
4. Opfølgning: konkrete ting, der skal følges op.`,
  },
  de: {
    pointNotChecked: "Die KI-Prüfung hat diesen Punkt nicht bewertet. Prüfen Sie das Gespräch selbst.",
    defaultReportName: "Standardnotiz",
    defaultReportInstructions: `Schreiben Sie eine kurze Notiz über das Gespräch für die Leitung und Compliance des Callcenters:
1. Zusammenfassung (2–4 Sätze): wer hat angerufen, was wurde angeboten und wie endete das Gespräch.
2. Angebot und Bedingungen: Preis, Vertragslaufzeit und Widerrufsrecht, wie der Verkäufer sie dargestellt hat.
3. Antwort des Kunden: hat der Kunde angenommen, und wie.
4. Nachverfolgung: konkrete Punkte, die nachverfolgt werden müssen.`,
  },
};

// A stored language code, or Norwegian for anything else (old rows, a removed language).
export function localeOr(value: unknown, fallback: Locale = DEFAULT_LOCALE): Locale {
  return isLocale(value) ? value : fallback;
}

// The instruction that tells the AI which language to write in.
export function writeIn(locale: Locale): string {
  return `Write in ${LOCALES[locale].aiName}.`;
}

// The languages spoken in a call, as Soniox codes; null follows the call centre.
export function spokenLanguages(body: Body, key: string): string[] | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_TRANSCRIPTION_LANGUAGES ||
    !value.every((v) => typeof v === "string" && SONIOX_LANGUAGE.test(v))
  ) {
    throw new BadRequest(`Velg mellom ett og ${MAX_TRANSCRIPTION_LANGUAGES} språk.`);
  }
  return [...new Set(value as string[])];
}

