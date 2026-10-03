"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton } from "@/components/admin/field";
import { adminFetch } from "@/lib/admin";
import { lines } from "@/lib/work";

interface SystemSettings {
  transcriptionMode: "realtime" | "chunked";
  transcriptionTerms: string[];
  aiModel: string;
  aiModels: { key: string; name: string; description: string }[];
}

export default function SystemPage() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [mode, setMode] = useState<SystemSettings["transcriptionMode"]>("realtime");
  const [terms, setTerms] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    adminFetch<SystemSettings>("/system")
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
        setMode(s.transcriptionMode);
        setTerms(s.transcriptionTerms.join("\n"));
        setAiModel(s.aiModel);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await adminFetch("/system", { method: "PATCH", body: { transcriptionMode: mode, transcriptionTerms: lines(terms), aiModel } });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!settings) return error ? <ErrorMessage message={error} /> : <p className="text-muted">Laster …</p>;
  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">System</h1>
        <p className="mt-2 text-muted">Innstillinger som gjelder alle callsentre.</p>
      </div>
      <Card title="Transkripsjon og AI">
        <form onSubmit={save} className="flex flex-col gap-5">
          <fieldset className="flex min-w-0 flex-col gap-3">
            <legend className="mb-1 text-sm font-semibold">Transkripsjonsmodus</legend>
            <label className="flex items-start gap-3">
              <input type="radio" name="mode" className="mt-1" checked={mode === "chunked"} onChange={() => setMode("chunked")} />
              <span>
                <span className="font-semibold">Bitvis (standard)</span>
                <span className="block text-sm text-muted">
                  Som i MedSide: hvert 15. sekund sendes en bit til Soniox (stt-async-v5, EU), og teksten kommer fortløpende. Bitene blir
                  samtalens transkripsjon, så den er klar når opptaket stoppes. Mangler en bit, transkriberes hele opptaket i stedet.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input type="radio" name="mode" className="mt-1" checked={mode === "realtime"} onChange={() => setMode("realtime")} />
              <span>
                <span className="font-semibold">Sanntid</span>
                <span className="block text-sm text-muted">
                  Selgeren ser teksten mens samtalen pågår (Soniox i EU, midlertidig nøkkel i nettleseren). Faller sanntid ut, tar bitvis over
                  uten at selgeren må gjøre noe. Den lagrede transkripsjonen lages fra hele opptaket etter samtalen.
                </span>
              </span>
            </label>
          </fieldset>
          <p className="text-sm text-muted">
            I begge moduser lastes hele opptaket også opp fortløpende og lagres for avspilling. Lyd og tekst hos Soniox slettes med en gang teksten
            er hentet.
          </p>
          <Field label="Ordliste" hint="Ett ord eller navn per linje, for eksempel produkt- og selskapsnavn. Sendes til Soniox som kontekst.">
            <textarea rows={6} className={`${inputClass} py-2`} value={terms} onChange={(e) => setTerms(e.target.value)} />
          </Field>
          <fieldset className="flex min-w-0 flex-col gap-3">
            <legend className="mb-1 text-sm font-semibold">AI-modell for AI-kontroll og rapporter</legend>
            {settings.aiModels.map((m) => (
              <label key={m.key} className="flex items-start gap-3">
                <input type="radio" name="ai-model" className="mt-1" checked={aiModel === m.key} onChange={() => setAiModel(m.key)} />
                <span>
                  <span className="font-semibold">{m.name}</span>
                  <span className="block text-sm text-muted">{m.description}</span>
                </span>
              </label>
            ))}
            <p className="text-sm text-muted">
              Claude via Amazon Bedrock med EU-endepunkt: behandles bare i EU-regioner. Gjelder samtaler som behandles etter at du har lagret.
              Modellen må være slått på i Bedrock (Model access) i eu-north-1.
            </p>
          </fieldset>
          <ErrorMessage message={error} />
          {saved && <p role="status">Lagret.</p>}
          <div>
            <button type="submit" className={primaryButton}>
              Lagre
            </button>
          </div>
        </form>
      </Card>
    </section>
  );
}
