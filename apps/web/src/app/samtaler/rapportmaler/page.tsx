"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import {
  ErrorMessage,
  Field,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/components/admin/field";
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
  const t = useTranslations("calls");
  const tc = useTranslations("common");
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
  if (!me.permissions.includes("report_templates.manage"))
    return <NoAccess text={t("templates.noAccess")} />;
  const active = templates?.filter((x) => !x.archivedAt) ?? [];
  const archived = templates?.filter((x) => x.archivedAt) ?? [];

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/samtaler"
            className="inline-flex min-h-11 items-center text-sm font-semibold text-brand"
          >
            {t("back")}
          </Link>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
            {t("templates.title")}
          </h1>
          <p className="mt-2 text-muted">{t("templates.intro")}</p>
        </div>
        {!creating && (
          <button
            type="button"
            className={primaryButton}
            onClick={() => setCreating(true)}
          >
            {t("templates.new")}
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
        !error && <p className="text-muted">{tc("loading")}</p>
      ) : active.length === 0 && !creating ? (
        <p className="text-muted">{t("templates.none")}</p>
      ) : (
        active.map((x) => (
          <TemplateForm
            key={x.id}
            template={x}
            onSave={async (body) => {
              await orgFetch(`/report-templates/${x.id}`, {
                method: "PATCH",
                body,
              });
              await load();
            }}
            onArchive={async () => {
              await orgFetch(`/report-templates/${x.id}`, {
                method: "PATCH",
                body: { archived: true },
              });
              await load();
            }}
          />
        ))
      )}
      {archived.length > 0 && (
        <Card title={t("templates.archived")}>
          <ul className="divide-y divide-line">
            {archived.map((x) => (
              <li
                key={x.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <span>{x.name}</span>
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() =>
                    orgFetch(`/report-templates/${x.id}`, {
                      method: "PATCH",
                      body: { archived: false },
                    })
                      .then(load)
                      .catch((e: Error) => setError(e.message))
                  }
                >
                  {t("templates.restore")}
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
  onSave: (body: {
    name: string;
    instructions: string;
    isDefault: boolean;
  }) => Promise<void>;
  onCancel?: () => void;
  onArchive?: () => Promise<void>;
}) {
  const t = useTranslations("calls");
  const [name, setName] = useState(template?.name ?? "");
  const [instructions, setInstructions] = useState(
    template?.instructions ?? "",
  );
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
    <Card title={template ? template.name : t("templates.new")}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t("templates.name")}>
          <input
            required
            maxLength={200}
            className={`${inputClass} sm:max-w-md`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field
          label={t("templates.instructions")}
          hint={t("templates.instructionsHint")}
        >
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
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          {t("templates.isDefault")}
        </label>
        <ErrorMessage message={error} />
        {saved && <p role="status">{t("saved")}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className={primaryButton}>
            {t("save")}
          </button>
          {onCancel && (
            <button
              type="button"
              className={secondaryButton}
              onClick={onCancel}
            >
              {t("cancel")}
            </button>
          )}
          {onArchive && (
            <button
              type="button"
              className={secondaryButton}
              onClick={() => {
                if (
                  window.confirm(
                    t("templates.confirmArchive", {
                      name: template?.name ?? "",
                    }),
                  )
                )
                  void onArchive().catch((e: Error) => setError(e.message));
              }}
            >
              {t("templates.archive")}
            </button>
          )}
        </div>
      </form>
    </Card>
  );
}
