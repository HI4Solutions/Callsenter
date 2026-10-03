"use client";

import { useState } from "react";
import { usePageTitle } from "@/lib/use-page-title";

const RESULTS: Record<string, { title: string; text: string }> = {
  godtatt: { title: "Takk! Avtalen er bekreftet", text: "Du har godtatt tilbudet. Du kan lukke denne siden." },
  avslatt: { title: "Tilbudet er avslått", text: "Avtalen blir ikke inngått. Du kan lukke denne siden." },
  avbrutt: { title: "Identifiseringen ble avbrutt", text: "Ingenting er godtatt. Åpne lenken på nytt hvis du vil godta tilbudet." },
  feil_person: {
    title: "Tilbudet må godtas av kjøperen",
    text: "Navnet eller mobilnummeret ditt stemmer ikke med kjøperen, så ingenting er godtatt. Tilbudet må godtas av kjøperen selv med BankID eller Vipps. Ta kontakt med selgeren hvis opplysningene om deg er feil.",
  },
  utlopt: { title: "Fristen har gått ut", text: "Ta kontakt med selgeren hvis du fortsatt ønsker avtalen." },
  avgjort: { title: "Tilbudet er allerede besvart", text: "Det er ikke mulig å svare på det samme tilbudet to ganger." },
  trukket: { title: "Tilbudet gjelder ikke lenger", text: "Selgeren har trukket tilbake eller endret tilbudet. Ta kontakt med selgeren hvis du har spørsmål." },
  annen_nettleser: {
    title: "Åpne lenken på nytt",
    text: "Identifiseringen må gjøres i samme nettleser som du åpnet tilbudet i. Åpne lenken fra selgeren igjen, les tilbudet og godta derfra.",
  },
  ikke_satt_opp: { title: "Denne metoden er ikke tilgjengelig", text: "Prøv en annen måte å identifisere deg på." },
  ukjent: { title: "Lenken er ugyldig", text: "Sjekk at du har brukt hele lenken fra selgeren." },
  feil: { title: "Noe gikk galt", text: "Ingenting er godtatt. Åpne lenken på nytt og prøv igjen om litt." },
};

export default function ConfirmDonePage() {
  const [result] = useState(() =>
    typeof window === "undefined" ? "feil" : (new URLSearchParams(window.location.search).get("resultat") ?? "feil"),
  );
  const shown = RESULTS[result] ?? RESULTS.feil!;
  usePageTitle(`${shown.title} · VeriQall`);
  return (
    <section className="mx-auto max-w-xl">
      <h1 className="text-3xl font-extrabold tracking-tight">{shown.title}</h1>
      <p className="mt-4">{shown.text}</p>
    </section>
  );
}
