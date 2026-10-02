"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { useWorkMe } from "@/components/work/work-shell";
import type { CallDetail, Note } from "@/lib/calls";
import { formatDateTime } from "@/lib/format";
import { orgFetch } from "@/lib/org";

interface NoteTemplate {
  id: string;
  name: string;
  isDefault: boolean;
  archivedAt: string | null;
}

// Notatpanelet: every note from the call, newest first. A note is written by AI from the
// transcript, the product template and the seller's additional information. The seller may
// adjust it; the AI text is kept and shown beside it. "Regenerer" makes another note from the
// same transcript, with the note template chosen.
export function NotesPanel({ call, onChanged }: { call: CallDetail; onChanged: () => Promise<unknown> }) {
  const me = useWorkMe();
  const [templates, setTemplates] = useState<NoteTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reportsOn = me?.modules?.includes("reports") ?? false;
  const canRequest =
    reportsOn &&
    (call.isOwn || (me?.permissions.includes("report_templates.manage") ?? false)) &&
    (call.status === "transcribed" || call.status === "analyzed") &&
    call.segments.length > 0;

  useEffect(() => {
    if (!canRequest) return;
    let cancelled = false;
    orgFetch<NoteTemplate[]>("/report-templates")
      .then((rows) => !cancelled && setTemplates(rows.filter((t) => !t.archivedAt)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [canRequest]);

  const pending = call.reports.some((r) => r.status === "pending");

  async function regenerate() {
    setError(null);
    setBusy(true);
    try {
      await orgFetch(`/calls/${call.id}/notes`, {
        method: "POST",
        body: { templateId: templateId || null },
      });
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Card title="Notater">
      <div className="flex flex-col gap-4">
        {call.reports.length === 0 && (
          <p className="text-muted">
            {reportsOn ? "Notatet lages når samtalen er transkribert." : "Rapporter er ikke slått på for callsenteret."}
          </p>
        )}
        {call.reports.map((r) => (
          <NoteCard key={r.id} note={r} call={call} onChanged={onChanged} />
        ))}
        {canRequest && (
          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <Field label="Notatmal" hint="Samme transkripsjon, med en annen mal. Det nye notatet legges til over.">
              <select className={inputClass} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">
                  Standard
                  {templates.find((t) => t.isDefault) ? ` (${templates.find((t) => t.isDefault)!.name})` : ""}
                </option>
                {templates
                  .filter((t) => !t.isDefault)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </Field>
            <ErrorMessage message={error} />
            <div>
              <button type="button" className={secondaryButton} disabled={busy || pending} onClick={regenerate}>
                {pending ? "Lager notat …" : "Regenerer"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function NoteCard({ note, call, onChanged }: { note: Note; call: CallDetail; onChanged: () => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.content ?? "");
  const [showAi, setShowAi] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (note.status === "pending") {
    return (
      <article className="rounded-lg border border-line p-3" aria-busy="true">
        <h3 className="font-bold">{note.templateName}</h3>
        <p className="mt-1 text-muted" role="status">
          Notatet skrives …
        </p>
      </article>
    );
  }
  if (note.status === "failed") {
    return (
      <article className="rounded-lg border border-line p-3">
        <h3 className="font-bold">{note.templateName}</h3>
        <p className="mt-1">{note.error ?? "Notatet kunne ikke lages."}</p>
      </article>
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await orgFetch(`/calls/${call.id}/notes/${note.id}`, {
        method: "PATCH",
        body: { content: text },
      });
      await onChanged();
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(note.content ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Kunne ikke kopiere. Merk teksten og kopier den selv.");
    }
  }

  const edited = note.edits > 0;
  return (
    <article className="rounded-lg border border-line p-3">
      <h3 className="font-bold">{note.templateName}</h3>
      <p className="mt-1 text-sm text-muted">
        {edited
          ? `Justert av ${note.editedByName ?? "selgeren"} ${note.editedAt ? formatDateTime(note.editedAt) : ""}. Laget av AI ${formatDateTime(note.createdAt)}.`
          : `AI-generert basert på transkripsjon og valgt mal, ${formatDateTime(note.createdAt)}.`}
      </p>
      {editing ? (
        <form onSubmit={save} className="mt-3 flex flex-col gap-3">
          <label className="sr-only" htmlFor={`note-${note.id}`}>
            Notat
          </label>
          <textarea
            id={`note-${note.id}`}
            rows={12}
            maxLength={20000}
            required
            className={`${inputClass} py-2`}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="text-sm text-muted">AI-versjonen beholdes, og endringen lagres med navnet ditt.</p>
          <ErrorMessage message={error} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primaryButton} disabled={busy}>
              Lagre
            </button>
            <button
              type="button"
              className={secondaryButton}
              onClick={() => {
                setText(note.content ?? "");
                setEditing(false);
              }}
            >
              Avbryt
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="mt-3 whitespace-pre-wrap [overflow-wrap:anywhere]">{note.content}</p>
          {edited && showAi && (
            <div className="mt-3 rounded-lg bg-bg p-3">
              <p className="text-sm font-semibold">AI-versjonen</p>
              <p className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{note.aiContent}</p>
            </div>
          )}
          <ErrorMessage message={error} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={secondaryButton} onClick={copy}>
              {copied ? "Kopiert" : "Kopier"}
            </button>
            {call.isOwn && (
              <button
                type="button"
                className={secondaryButton}
                onClick={() => {
                  setText(note.content ?? "");
                  setEditing(true);
                }}
              >
                Rediger
              </button>
            )}
            {edited && (
              <button type="button" className={secondaryButton} onClick={() => setShowAi((v) => !v)}>
                {showAi ? "Skjul AI-versjonen" : "Vis AI-versjonen"}
              </button>
            )}
          </div>
        </>
      )}
    </article>
  );
}
