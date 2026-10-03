"use client";

import { type Locale, LOCALE_CODES, LOCALES } from "@veriqall/shared";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Card } from "@/components/admin/card";
import {
  ErrorMessage,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/components/admin/field";
import {
  NoteTemplatePicker,
  useNoteTemplates,
} from "@/components/calls/note-templates";
import { useWorkMe } from "@/components/work/work-shell";
import type { CallDetail, Note } from "@/lib/calls";
import { formatDateTime } from "@/lib/format";
import { orgFetch } from "@/lib/org";

// Notatpanelet: every note from the call, newest first. A note is written by AI from the
// transcript, the product template and the seller's additional information. The seller may
// adjust it; the AI text is kept and shown beside it. "Regenerer" makes new notes from the same
// transcript with the note templates chosen: in the studio those chosen at the top (chosen), on
// the call page those picked here.
export function NotesPanel({
  call,
  onChanged,
  chosen,
}: {
  call: CallDetail;
  onChanged: () => Promise<unknown>;
  chosen?: string[];
}) {
  const me = useWorkMe();
  const reportsOn = me?.modules?.includes("reports") ?? false;
  const canRequest =
    reportsOn &&
    (call.isOwn ||
      (me?.permissions.includes("report_templates.manage") ?? false)) &&
    (call.status === "transcribed" || call.status === "analyzed") &&
    call.segments.length > 0;
  const templates = useNoteTemplates(canRequest && !chosen);
  const [picked, setPicked] = useState<string[]>([]);
  const tl = useTranslations("languages");
  const t = useTranslations("calls.notes");
  // New notes are written in the call's language unless another is chosen here.
  const callLocale = call.outputLocale ?? call.defaultOutputLocale;
  const [locale, setLocale] = useState<Locale>(callLocale);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pending = call.reports.some((r) => r.status === "pending");

  async function regenerate() {
    setError(null);
    setBusy(true);
    try {
      await orgFetch(`/calls/${call.id}/notes`, {
        method: "POST",
        body: {
          templateIds: chosen ?? picked,
          locale: locale === callLocale ? null : locale,
        },
      });
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Card title={t("title")}>
      <div className="flex flex-col gap-4">
        {call.reports.length === 0 && (
          <p className="text-muted">
            {reportsOn ? t("whenTranscribed") : t("reportsOff")}
          </p>
        )}
        {call.reports.map((r) => (
          <NoteCard key={r.id} note={r} call={call} onChanged={onChanged} />
        ))}
        {canRequest && (
          <div className="flex flex-col gap-3 border-t border-line pt-4">
            {chosen ? (
              <p className="text-sm text-muted">{t("regenerateChosen")}</p>
            ) : (
              <NoteTemplatePicker
                templates={templates}
                chosen={picked}
                onChange={setPicked}
              />
            )}
            {!call.outputLocaleLocked && (
              <label className="flex flex-col gap-1 sm:max-w-xs">
                <span className="text-sm font-semibold">
                  {tl("regenerateIn")}
                </span>
                <select
                  className={inputClass}
                  value={locale}
                  onChange={(e) => setLocale(e.target.value as Locale)}
                >
                  {LOCALE_CODES.map((code) => (
                    <option key={code} value={code} lang={LOCALES[code].tag}>
                      {LOCALES[code].name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <ErrorMessage message={error} />
            <div>
              <button
                type="button"
                className={secondaryButton}
                disabled={busy || pending}
                onClick={regenerate}
              >
                {pending ? t("making") : t("regenerate")}
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function NoteCard({
  note,
  call,
  onChanged,
}: {
  note: Note;
  call: CallDetail;
  onChanged: () => Promise<unknown>;
}) {
  const t = useTranslations("calls.notes");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.content ?? "");
  const [showAi, setShowAi] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (note.status === "pending") {
    return (
      <article className="rounded-lg border border-line p-3" aria-busy="true">
        <h3 className="font-bold">
          {note.templateName}
          {note.locale && (
            <span className="ml-2 text-sm font-normal text-muted">
              {LOCALES[note.locale].name}
            </span>
          )}
        </h3>
        <p className="mt-1 text-muted" role="status">
          {t("writing")}
        </p>
      </article>
    );
  }
  if (note.status === "failed") {
    return (
      <article className="rounded-lg border border-line p-3">
        <h3 className="font-bold">
          {note.templateName}
          {note.locale && (
            <span className="ml-2 text-sm font-normal text-muted">
              {LOCALES[note.locale].name}
            </span>
          )}
        </h3>
        <p className="mt-1">{note.error ?? t("failed")}</p>
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
      setError(t("copyFailed"));
    }
  }

  const edited = note.edits > 0;
  return (
    <article className="rounded-lg border border-line p-3">
      <h3 className="font-bold">
        {note.templateName}
        {note.locale && (
          <span className="ml-2 text-sm font-normal text-muted">
            {LOCALES[note.locale].name}
          </span>
        )}
      </h3>
      <p className="mt-1 text-sm text-muted">
        {edited
          ? t("edited", {
              name: note.editedByName ?? t("seller"),
              date: note.editedAt ? formatDateTime(note.editedAt) : "",
              created: formatDateTime(note.createdAt),
            })
          : t("aiGenerated", { date: formatDateTime(note.createdAt) })}
      </p>
      {editing ? (
        <form onSubmit={save} className="mt-3 flex flex-col gap-3">
          <label className="sr-only" htmlFor={`note-${note.id}`}>
            {t("label")}
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
          <p className="text-sm text-muted">{t("aiKept")}</p>
          <ErrorMessage message={error} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primaryButton} disabled={busy}>
              {t("save")}
            </button>
            <button
              type="button"
              className={secondaryButton}
              onClick={() => {
                setText(note.content ?? "");
                setEditing(false);
              }}
            >
              {t("cancel")}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="mt-3 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {note.content}
          </p>
          {edited && showAi && (
            <div className="mt-3 rounded-lg bg-bg p-3">
              <p className="text-sm font-semibold">{t("aiVersion")}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
                {note.aiContent}
              </p>
            </div>
          )}
          <ErrorMessage message={error} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={secondaryButton} onClick={copy}>
              {copied ? t("copied") : t("copy")}
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
                {t("edit")}
              </button>
            )}
            {edited && (
              <button
                type="button"
                className={secondaryButton}
                onClick={() => setShowAi((v) => !v)}
              >
                {showAi ? t("hideAi") : t("showAi")}
              </button>
            )}
          </div>
        </>
      )}
    </article>
  );
}
