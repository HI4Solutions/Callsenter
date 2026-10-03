"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { orgFetch } from "@/lib/org";

export interface NoteTemplate {
  id: string;
  name: string;
  isDefault: boolean;
  archivedAt: string | null;
}

// The call centre's note templates in use (Notatmaler, under Samtaler).
export function useNoteTemplates(enabled = true) {
  const [templates, setTemplates] = useState<NoteTemplate[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    orgFetch<NoteTemplate[]>("/report-templates")
      .then(
        (rows) => !cancelled && setTemplates(rows.filter((t) => !t.archivedAt)),
      )
      .catch(() => !cancelled && setTemplates([]));
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return templates;
}

// Notatmaler in place of Notatstudio's add-on templates: switched on and off one by one, several
// at once, and each gives its own note. None chosen means the call centre's default note.
export function NoteTemplatePicker({
  templates,
  chosen,
  onChange,
  disabled,
}: {
  templates: NoteTemplate[] | null;
  chosen: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("calls.notes.picker");
  if (!templates) return <p className="text-sm text-muted">{t("loading")}</p>;
  if (!templates.length)
    return <p className="text-sm text-muted">{t("standardOnly")}</p>;
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold">{t("legend")}</legend>
      <div className="flex flex-wrap gap-2">
        {templates.map((x) => {
          const on = chosen.includes(x.id);
          return (
            <button
              key={x.id}
              type="button"
              aria-pressed={on}
              disabled={disabled || (!on && chosen.length >= 5)}
              onClick={() =>
                onChange(
                  on ? chosen.filter((id) => id !== x.id) : [...chosen, x.id],
                )
              }
              className={`min-h-11 rounded-full border px-4 text-sm font-semibold disabled:opacity-50 ${
                on
                  ? "border-brand bg-brand text-on-brand"
                  : "border-line bg-surface hover:bg-bg"
              }`}
            >
              {on && <span aria-hidden="true">✓ </span>}
              {x.name}
            </button>
          );
        })}
      </div>
      <p className="text-sm text-muted">
        {chosen.length
          ? t("gives", { count: chosen.length })
          : t("noneChosen", {
              name:
                templates.find((x) => x.isDefault)?.name ?? t("standardNote"),
            })}
      </p>
    </fieldset>
  );
}
