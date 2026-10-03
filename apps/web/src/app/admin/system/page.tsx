"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import {
  ErrorMessage,
  Field,
  inputClass,
  primaryButton,
  LoadState,
} from "@/components/admin/field";
import { adminFetch } from "@/lib/admin";
import { lines } from "@/lib/work";

interface SystemSettings {
  transcriptionMode: "realtime" | "chunked";
  transcriptionTerms: string[];
  aiModel: string;
  aiModels: { key: string; name: string; description: string }[];
}

export default function SystemPage() {
  const t = useTranslations("admin.system");
  const ts = useTranslations("admin.shared");
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [mode, setMode] =
    useState<SystemSettings["transcriptionMode"]>("realtime");
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
      await adminFetch("/system", {
        method: "PATCH",
        body: {
          transcriptionMode: mode,
          transcriptionTerms: lines(terms),
          aiModel,
        },
      });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!settings) return <LoadState error={error} />;
  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted">{t("intro")}</p>
      </div>
      <Card title={t("card")}>
        <form onSubmit={save} className="flex flex-col gap-5">
          <fieldset className="flex min-w-0 flex-col gap-3">
            <legend className="mb-1 text-sm font-semibold">{t("mode")}</legend>
            <label className="flex items-start gap-3">
              <input
                type="radio"
                name="mode"
                className="mt-1"
                checked={mode === "chunked"}
                onChange={() => setMode("chunked")}
              />
              <span>
                <span className="font-semibold">{t("chunked")}</span>
                <span className="block text-sm text-muted">
                  {t("chunkedText")}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input
                type="radio"
                name="mode"
                className="mt-1"
                checked={mode === "realtime"}
                onChange={() => setMode("realtime")}
              />
              <span>
                <span className="font-semibold">{t("realtime")}</span>
                <span className="block text-sm text-muted">
                  {t("realtimeText")}
                </span>
              </span>
            </label>
          </fieldset>
          <p className="text-sm text-muted">{t("bothModes")}</p>
          <Field label={t("terms")} hint={t("termsHint")}>
            <textarea
              rows={6}
              className={`${inputClass} py-2`}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
            />
          </Field>
          <fieldset className="flex min-w-0 flex-col gap-3">
            <legend className="mb-1 text-sm font-semibold">
              {t("aiModel")}
            </legend>
            {settings.aiModels.map((m) => (
              <label key={m.key} className="flex items-start gap-3">
                <input
                  type="radio"
                  name="ai-model"
                  className="mt-1"
                  checked={aiModel === m.key}
                  onChange={() => setAiModel(m.key)}
                />
                <span>
                  <span className="font-semibold">{m.name}</span>
                  <span className="block text-sm text-muted">
                    {m.description}
                  </span>
                </span>
              </label>
            ))}
            <p className="text-sm text-muted">{t("aiModelNote")}</p>
          </fieldset>
          <ErrorMessage message={error} />
          {saved && <p role="status">{ts("saved")}</p>}
          <div>
            <button type="submit" className={primaryButton}>
              {ts("save")}
            </button>
          </div>
        </form>
      </Card>
    </section>
  );
}
