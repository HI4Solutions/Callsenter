"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { NoAccess, useWorkMe } from "@/components/work/work-shell";
import { orgFetch } from "@/lib/org";

interface ReportTemplate {
  id: string;
  name: string;
  instructions: string;
  isDefault: boolean;
  archivedAt: string | null;
}

// Report templates (module 6): what the AI writes after each call. The default template is used
// for new calls; without one the built-in standard report is used.
export default function ReportTemplatesPage() {
  const me = useWorkMe();
  const [templates, setTemplates] = useState<ReportTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(
    () =>
      orgFetch<ReportTemplate[]>("/report-templates")
        .then(setTemplates)
        .catch((e: Error) => setError(e.message)),
    [],
  );
  useEffect(() => {
    let cancelled = false;
    orgFetch<ReportTemplate[]>("/report-templates")
      .then((rows) => !cancelled && setTemplates(rows))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!me) return null;
  if (!me.permissions.includes("report_templates.manage")) return <NoAccess text="Du har ikke tilgang til notatmaler." />;
  const active = templates?.filter((t) => !t.archivedAt) ?? [];
  const archived = templates?.filter((t) => t.archivedAt) ?? [];

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/samtaler" className="text-sm font-semibold text-brand">
            ← Alle samtaler
          </Link>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Notatmaler</h1>
          <p className="mt-2 text-muted">
            AI skriver et notat etter hver samtale etter standardmalen. Uten egen standardmal brukes VeriQalls standardnotat. I Samtalestudio kan selgeren lage flere notater fra samme samtale med andre maler.
          </p>
        </div>
        {!creating && (
          <button type="button" className={primaryButton} onClick={() => setCreating(true)}>
            Ny mal
          </button>
        )}
      </div>
      <ErrorMessage message={error} />
      {creating && (
        <TemplateForm
          onCancel={() => setCreating(false)}
          onSave={async (body) => {
            await orgFetch("/report-templates", { method: "POST", body });
            setCreating(false);
            await load();
          }}
        />
      )}
      {!templates ? (
        !error && <p className="text-muted">Laster …</p>
      ) : active.length === 0 && !creating ? (
        <p className="text-muted">Ingen egne maler ennå.</p>
      ) : (
        active.map((t) => (
          <TemplateForm
            key={t.id}
            template={t}
            onSave={async (body) => {
              await orgFetch(`/report-templates/${t.id}`, { method: "PATCH", body });
              await load();
            }}
            onArchive={async () => {
              await orgFetch(`/report-templates/${t.id}`, { method: "PATCH", body: { archived: true } });
              await load();
            }}
          />
        ))
      )}
      {archived.length > 0 && (
        <Card title="Arkiverte maler">
          <ul className="divide-y divide-line">
            {archived.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                <span>{t.name}</span>
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() =>
                    orgFetch(`/report-templates/${t.id}`, { method: "PATCH", body: { archived: false } })
                      .then(load)
                      .catch((e: Error) => setError(e.message))
                  }
                >
                  Gjenopprett
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function TemplateForm({
  template,
  onSave,
  onCancel,
  onArchive,
}: {
  template?: ReportTemplate;
  onSave: (body: { name: string; instructions: string; isDefault: boolean }) => Promise<void>;
  onCancel?: () => void;
  onArchive?: () => Promise<void>;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [instructions, setInstructions] = useState(template?.instructions ?? "");
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await onSave({ name, instructions, isDefault });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={template ? template.name : "Ny mal"}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Navn">
          <input required maxLength={200} className={`${inputClass} sm:max-w-md`} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Instruksjoner til AI" hint="Hva notatet skal inneholde, i hvilken rekkefølge og hvor lang den skal være.">
          <textarea
            required
            rows={8}
            maxLength={10000}
            className={`${inputClass} py-2`}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </Field>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          Standardmal for nye samtaler
        </label>
        <ErrorMessage message={error} />
        {saved && <p role="status">Lagret.</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className={primaryButton}>
            Lagre
          </button>
          {onCancel && (
            <button type="button" className={secondaryButton} onClick={onCancel}>
              Avbryt
            </button>
          )}
          {onArchive && (
            <button
              type="button"
              className={secondaryButton}
              onClick={() => {
                if (window.confirm(`Arkivere ${template?.name}?`)) void onArchive().catch((e: Error) => setError(e.message));
              }}
            >
              Arkiver
            </button>
          )}
        </div>
      </form>
    </Card>
  );
}
