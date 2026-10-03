"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { LanguagePicker } from "@/components/language-picker";
import { usePageTitle } from "@/lib/use-page-title";

const RESULTS = [
  "godtatt",
  "avslatt",
  "avbrutt",
  "feil_person",
  "utlopt",
  "avgjort",
  "trukket",
  "annen_nettleser",
  "ikke_satt_opp",
  "ukjent",
  "feil",
] as const;

export default function ConfirmDonePage() {
  const t = useTranslations("confirm");
  const [result] = useState(() => {
    const value = typeof window === "undefined" ? "feil" : new URLSearchParams(window.location.search).get("resultat");
    return (RESULTS as readonly string[]).includes(value ?? "") ? (value as (typeof RESULTS)[number]) : "feil";
  });
  usePageTitle(`${t(`results.${result}.title`)} · VeriQall`);
  return (
    <section className="mx-auto max-w-xl">
      <h1 className="text-3xl font-extrabold tracking-tight">{t(`results.${result}.title`)}</h1>
      <p className="mt-4">{t(`results.${result}.text`)}</p>
      <LanguagePicker signedIn={false} className="mt-8" />
    </section>
  );
}
