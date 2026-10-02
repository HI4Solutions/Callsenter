"use client";

import { useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, inputClass, secondaryButton } from "@/components/admin/field";

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
    <Card title="Tilleggsinformasjon">
      {canEdit ? (
        <div className="flex flex-col gap-3">
          <label className="sr-only" htmlFor="additional-info">
            Tilleggsinformasjon
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
            placeholder="Valgfritt. For eksempel en avtale kunden har fra før."
          />
          <p className="text-sm text-muted">
            {hint ?? "Tas med når notatet lages, merket som selgerens opplysning. AI-kontrollen bruker bare det som ble sagt."}
          </p>
          <ErrorMessage message={error} />
          {onSave && text !== saved && (
            <div>
              <button type="button" className={secondaryButton} disabled={busy} onClick={save}>
                Lagre
              </button>
            </div>
          )}
        </div>
      ) : value ? (
        <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{value}</p>
      ) : (
        <p className="text-muted">Ingen.</p>
      )}
    </Card>
  );
}
