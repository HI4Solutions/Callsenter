"use client";

import { type Locale, LOCALE_CODES, LOCALES } from "@veriqall/shared";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import {
  ErrorMessage,
  Field,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/components/admin/field";
import { Flag, type FlagLevel } from "@/components/flag";
import { formatDuration } from "@/lib/calls";
import type {
  ClaimFinding,
  ComplaintAi,
  ComplaintDetail,
  Verdict,
} from "@/lib/complaints";
import { formatDateTime } from "@/lib/format";
import { orgFetch } from "@/lib/org";

// The AI's view of the call, in the reserved colors (CLAUDE.md, "Farger"): red when the call
// bears the customer out, green when it shows otherwise, and no color when it does not settle it.
const VERDICT_LEVEL: Record<Verdict, FlagLevel | null> = {
  justified: "violation",
  partly: "deviation",
  not_justified: "approved",
  unclear: null,
};
const FINDING_LEVEL: Record<ClaimFinding, FlagLevel | null> = {
  supported: "violation",
  contradicted: "approved",
  not_found: null,
};

function Badge({
  level,
  children,
}: {
  level: FlagLevel | null;
  children: React.ReactNode;
}) {
  return level ? (
    <Flag level={level}>{children}</Flag>
  ) : (
    <span className="inline-flex items-center rounded-full border border-line px-3 py-1 text-sm font-medium">
      {children}
    </span>
  );
}

// The complaint in the customer's own words: what the AI assesses and answers.
export function ComplaintText({
  complaint,
  onChanged,
}: {
  complaint: ComplaintDetail;
  onChanged: () => Promise<unknown>;
}) {
  const t = useTranslations("complaints.detail");
  const [text, setText] = useState(complaint.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const changed = text.trim() !== complaint.description.trim();

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await orgFetch(`/complaints/${complaint.id}`, {
        method: "PATCH",
        body: { description: text.trim() },
      });
      await onChanged();
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Card title={t("complaintText")}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <Field label={t("complaintTextLabel")} hint={t("complaintTextHint")}>
          <textarea
            rows={6}
            maxLength={10000}
            className={`${inputClass} py-2 print:hidden`}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSaved(false);
            }}
          />
        </Field>
        <p className="hidden whitespace-pre-wrap print:block">
          {complaint.description}
        </p>
        <ErrorMessage message={error} />
        <div className="flex flex-wrap items-center gap-3 print:hidden">
          <button
            type="submit"
            disabled={busy || !changed}
            className={primaryButton}
          >
            {t("saveText")}
          </button>
          <span role="status" className="text-sm text-muted">
            {saved && !changed ? t("saved") : ""}
          </span>
        </div>
      </form>
    </Card>
  );
}

async function ask(
  complaintId: string,
  body: Record<string, unknown>,
  onChanged: () => Promise<unknown>,
) {
  await orgFetch(`/complaints/${complaintId}/ai`, { method: "POST", body });
  await onChanged();
}

// What the AI found when it weighed the complaint against the call, point by point.
export function AssessmentCard({
  complaint,
  onChanged,
  onSeek,
}: {
  complaint: ComplaintDetail;
  onChanged: () => Promise<unknown>;
  onSeek?: (ms: number) => void;
}) {
  const t = useTranslations("complaints.detail.assessment");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = complaint.ai.filter((a) => a.kind === "assessment");
  const done = items.filter((a) => a.status === "done");
  const pending = items.some((a) => a.status === "pending");
  const failed = items[0]?.status === "failed" ? items[0] : null;
  const blocked = !complaint.callId
    ? t("needCall")
    : !complaint.description.trim()
      ? t("needText")
      : null;

  async function run() {
    setError(null);
    setBusy(true);
    try {
      await ask(complaint.id, { kind: "assessment" }, onChanged);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Card title={t("title")}>
      <div className="flex flex-col gap-5">
        <p className="text-muted">{t("intro")}</p>
        {done[0] && (
          <AssessmentView
            item={done[0]}
            changed={done[0].complaintText !== complaint.description.trim()}
            onSeek={onSeek}
          />
        )}
        {pending && (
          <p role="status" className="font-semibold">
            {t("working")}
          </p>
        )}
        {failed && (
          <p role="alert">{t("failed", { error: failed.error ?? "" })}</p>
        )}
        <ErrorMessage message={error} />
        <div className="print:hidden">
          {blocked ? (
            <p className="text-muted">{blocked}</p>
          ) : (
            <button
              type="button"
              disabled={busy || pending}
              className={done.length ? secondaryButton : primaryButton}
              onClick={run}
            >
              {done.length ? t("again") : t("run")}
            </button>
          )}
        </div>
        {done.length > 1 && (
          <details className="print:hidden">
            <summary className="cursor-pointer font-semibold">
              {t("earlier", { count: done.length - 1 })}
            </summary>
            <div className="mt-4 flex flex-col gap-6">
              {done.slice(1).map((a) => (
                <AssessmentView
                  key={a.id}
                  item={a}
                  changed={false}
                  onSeek={onSeek}
                />
              ))}
            </div>
          </details>
        )}
      </div>
    </Card>
  );
}

function AssessmentView({
  item,
  changed,
  onSeek,
}: {
  item: ComplaintAi;
  changed: boolean;
  onSeek?: (ms: number) => void;
}) {
  const t = useTranslations("complaints.detail.assessment");
  const r = item.result;
  if (!r) return null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge level={VERDICT_LEVEL[r.verdict]}>
          {t(`verdict.${r.verdict}`)}
        </Badge>
        <span className="text-sm text-muted">
          {t("madeBy", {
            date: formatDateTime(item.createdAt),
            name: item.requestedByName ?? "–",
          })}
        </span>
      </div>
      {changed && <p className="text-sm">{t("changed")}</p>}
      {r.summary && <p className="whitespace-pre-wrap">{r.summary}</p>}
      {r.claims.length > 0 && (
        <div>
          <h3 className="font-semibold">{t("claims")}</h3>
          <ul className="mt-2 flex flex-col gap-3">
            {r.claims.map((c, i) => (
              <li key={i} className="rounded-lg border border-line p-3">
                <Badge level={FINDING_LEVEL[c.finding]}>
                  {t(`finding.${c.finding}`)}
                </Badge>
                <p className="mt-2 font-semibold [overflow-wrap:anywhere]">
                  {c.claim}
                </p>
                {c.quote && (
                  <blockquote className="mt-2 border-l-2 border-line pl-3 [overflow-wrap:anywhere]">
                    «{c.quote}»
                  </blockquote>
                )}
                {c.startMs !== null && onSeek && (
                  <button
                    type="button"
                    className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-brand print:hidden"
                    onClick={() => onSeek(c.startMs!)}
                  >
                    {t("playAt", { time: formatDuration(c.startMs) })}
                  </button>
                )}
                {c.comment && (
                  <p className="mt-1 text-sm text-muted">{c.comment}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.nextSteps && (
        <div>
          <h3 className="font-semibold">{t("nextSteps")}</h3>
          <p className="mt-1 whitespace-pre-wrap">{r.nextSteps}</p>
        </div>
      )}
    </div>
  );
}

// A draft reply to the customer, written by the AI from the complaint, the assessment and the
// call, with the case handler's instructions. The case handler adjusts it and sends it from their
// own e-mail; the AI's text is kept beside the adjusted one.
export function ReplyCard({
  complaint,
  onChanged,
  defaultLocale,
  localeLocked,
}: {
  complaint: ComplaintDetail;
  onChanged: () => Promise<unknown>;
  defaultLocale: Locale;
  localeLocked: boolean;
}) {
  const t = useTranslations("complaints.detail.reply");
  const ta = useTranslations("complaints.detail.assessment");
  const tl = useTranslations("languages");
  const [instructions, setInstructions] = useState("");
  const [locale, setLocale] = useState<Locale | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = complaint.ai.filter((a) => a.kind === "reply");
  const done = items.filter((a) => a.status === "done");
  const pending = items.some((a) => a.status === "pending");
  const failed = items[0]?.status === "failed" ? items[0] : null;
  const blocked = !complaint.callId
    ? ta("needCall")
    : !complaint.description.trim()
      ? ta("needText")
      : null;

  async function make(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await ask(
        complaint.id,
        {
          kind: "reply",
          instructions: instructions.trim() || null,
          locale: locale || null,
        },
        onChanged,
      );
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Card title={t("title")}>
      <div className="flex flex-col gap-5">
        <p className="text-muted">{t("intro")}</p>
        {done[0] && (
          <DraftEditor
            key={`${done[0].id}/${done[0].editedAt ?? ""}`}
            complaintId={complaint.id}
            item={done[0]}
            onSaved={onChanged}
          />
        )}
        {pending && (
          <p role="status" className="font-semibold">
            {t("working")}
          </p>
        )}
        {failed && (
          <p role="alert">{t("failed", { error: failed.error ?? "" })}</p>
        )}
        {blocked ? (
          <p className="text-muted print:hidden">{blocked}</p>
        ) : (
          <form onSubmit={make} className="flex flex-col gap-4 print:hidden">
            <Field label={t("instructions")} hint={t("instructionsHint")}>
              <textarea
                rows={2}
                maxLength={2000}
                className={`${inputClass} py-2`}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </Field>
            {localeLocked ? (
              <p className="text-sm">
                <span className="font-semibold">{t("language")}: </span>
                {tl("locked", { language: LOCALES[defaultLocale].name })}
              </p>
            ) : (
              <Field label={t("language")}>
                <select
                  className={`${inputClass} sm:max-w-xs`}
                  value={locale}
                  onChange={(e) => setLocale(e.target.value as Locale | "")}
                >
                  <option value="">
                    {tl("followOrganization", {
                      language: LOCALES[defaultLocale].name,
                    })}
                  </option>
                  {LOCALE_CODES.map((code) => (
                    <option key={code} value={code} lang={LOCALES[code].tag}>
                      {LOCALES[code].name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <ErrorMessage message={error} />
            <div>
              <button
                type="submit"
                disabled={busy || pending}
                className={done.length ? secondaryButton : primaryButton}
              >
                {done.length ? t("again") : t("make")}
              </button>
            </div>
          </form>
        )}
        {done.length > 1 && (
          <details className="print:hidden">
            <summary className="cursor-pointer font-semibold">
              {t("earlier", { count: done.length - 1 })}
            </summary>
            <div className="mt-4 flex flex-col gap-6">
              {done.slice(1).map((a) => (
                <div key={a.id}>
                  <p className="text-sm text-muted">
                    {ta("madeBy", {
                      date: formatDateTime(a.createdAt),
                      name: a.requestedByName ?? "–",
                    })}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap rounded-lg bg-bg p-3 [overflow-wrap:anywhere]">
                    {a.content}
                  </p>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </Card>
  );
}

function DraftEditor({
  complaintId,
  item,
  onSaved,
}: {
  complaintId: string;
  item: ComplaintAi;
  onSaved: () => Promise<unknown>;
}) {
  const t = useTranslations("complaints.detail.reply");
  const ta = useTranslations("complaints.detail.assessment");
  const [text, setText] = useState(item.content ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const changed = text !== (item.content ?? "");

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await orgFetch(`/complaints/${complaintId}/ai/${item.id}`, {
        method: "PATCH",
        body: { content: text },
      });
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label={t("draft")} hint={t("placeholders")}>
        <textarea
          rows={14}
          maxLength={20000}
          className={`${inputClass} py-2 print:hidden`}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <p className="hidden whitespace-pre-wrap print:block">{text}</p>
      <p className="text-sm text-muted">
        {item.editedAt
          ? t("edited", {
              date: formatDateTime(item.editedAt),
              name: item.editedByName ?? "–",
            })
          : ta("madeBy", {
              date: formatDateTime(item.createdAt),
              name: item.requestedByName ?? "–",
            })}
      </p>
      <ErrorMessage message={error} />
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button
          type="button"
          className={primaryButton}
          onClick={() =>
            navigator.clipboard.writeText(text).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? t("copied") : t("copy")}
        </button>
        <button
          type="button"
          disabled={busy || !changed || !text.trim()}
          className={secondaryButton}
          onClick={save}
        >
          {t("save")}
        </button>
        <span role="status" className="sr-only">
          {copied ? t("copied") : ""}
        </span>
      </div>
    </div>
  );
}
