"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Card } from "@/components/admin/card";
import {
  ErrorMessage,
  inputClass,
  secondaryButton,
} from "@/components/admin/field";

// Tilleggsinformasjon: context that was not said in the call, such as an existing agreement or
// what was agreed by e-mail. Used when the note is written, never by the AI control.
export function AdditionalInfo({
  value,
  canEdit,
  onSave,
  hint,
  onChange,
}: {
  value: string;
  canEdit: boolean;
  // Saves the text; null when the call does not exist yet (the text is kept until it does).
  onSave: ((text: string) => Promise<void>) | null;
  hint?: string;
  onChange?: (text: string) => void;
}) {
  const t = useTranslations("calls");
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!onSave) return;
    setError(null);
    setBusy(true);
    try {
      await onSave(text);
      setSaved(text);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Card title={t("additionalInfo.title")}>
      {canEdit ? (
        <div className="flex flex-col gap-3">
          <label className="sr-only" htmlFor="additional-info">
            {t("additionalInfo.title")}
          </label>
          <textarea
            id="additional-info"
            rows={3}
            maxLength={2000}
            className={`${inputClass} py-2`}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              onChange?.(e.target.value);
            }}
            onBlur={() => text !== saved && void save()}
            placeholder={t("additionalInfo.placeholder")}
          />
          <p className="text-sm text-muted">
            {hint ?? t("additionalInfo.hint")}
          </p>
          <ErrorMessage message={error} />
          {onSave && text !== saved && (
            <div>
              <button
                type="button"
                className={secondaryButton}
                disabled={busy}
                onClick={save}
              >
                {t("save")}
              </button>
            </div>
          )}
        </div>
      ) : value ? (
        <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{value}</p>
      ) : (
        <p className="text-muted">{t("additionalInfo.none")}</p>
      )}
    </Card>
  );
}
