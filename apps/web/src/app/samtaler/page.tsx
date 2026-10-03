"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  ErrorMessage,
  Field,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/components/admin/field";
import { CallList } from "@/components/work/call-list";
import { NoAccess, useWorkMe } from "@/components/work/work-shell";
import { EmptyState } from "@/components/empty-state";
import {
  CALL_STATUS,
  type CallStatus,
  type CallSummary,
  canSeeCalls,
} from "@/lib/calls";
import { orgFetch } from "@/lib/org";

export default function CallsPage() {
  const me = useWorkMe();
  const t = useTranslations("calls.list");
  const td = useTranslations("domain");
  const tc = useTranslations("common");
  const permissions = me?.permissions ?? [];
  const visible = me ? canSeeCalls(me) : false;
  const canRecord = permissions.includes("calls.upload");
  const canReview = permissions.includes("flags.review");
  const [query, setQuery] = useState("");
  const [flag, setFlag] = useState("");
  const [status, setStatus] = useState("");
  const [mine, setMine] = useState(false);
  const [review, setReview] = useState(false);
  const [calls, setCalls] = useState<CallSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (flag) params.set("flag", flag);
    if (status) params.set("status", status);
    if (mine) params.set("mine", "1");
    if (review) params.set("review", "1");
    const load = () =>
      orgFetch<CallSummary[]>(`/calls${params.toString() ? `?${params}` : ""}`)
        .then((rows) => {
          if (cancelled) return;
          setCalls(rows);
          setError(null);
        })
        .catch((e: Error) => !cancelled && setError(e.message));
    const timer = setTimeout(load, 250);
    // Calls being transcribed change status on their own; check again while any are.
    const poll = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(poll);
    };
  }, [query, flag, status, mine, review, visible]);

  if (!me) return null;
  if (!(me.modules ?? []).includes("transcription"))
    return <NoAccess text={t("noModule")} />;
  if (!visible) return <NoAccess text={t("noAccess")} />;

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            {t("title")}
          </h1>
          <p className="mt-2 text-muted">{t("intro")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {permissions.includes("report_templates.manage") && (
            <Link href="/samtaler/rapportmaler" className={secondaryButton}>
              {t("noteTemplates")}
            </Link>
          )}
          {canRecord && (
            <Link href="/samtaler/opptak" className={primaryButton}>
              {t("studio")}
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <Field label={t("search")} hint={t("searchHint")}>
          <input
            type="search"
            className={`${inputClass} w-full sm:w-72`}
            placeholder={t("searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <Field label={t("flag")}>
          <select
            className={inputClass}
            value={flag}
            onChange={(e) => setFlag(e.target.value)}
          >
            <option value="">{t("all")}</option>
            <option value="red">{td("flag.violation")}</option>
            <option value="yellow">{td("flag.deviation")}</option>
            <option value="green">{td("flag.approved")}</option>
          </select>
        </Field>
        <Field label={t("status")}>
          <select
            className={inputClass}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">{t("all")}</option>
            {(Object.keys(CALL_STATUS) as CallStatus[]).map((s) => (
              <option key={s} value={s}>
                {td(`callStatus.${s}`)}
              </option>
            ))}
          </select>
        </Field>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => setMine(e.target.checked)}
          />
          {t("mine")}
        </label>
        {canReview && (
          <label className="inline-flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={review}
              onChange={(e) => setReview(e.target.checked)}
            />
            {t("unreviewed")}
          </label>
        )}
      </div>

      <ErrorMessage message={error} />
      {!calls ? (
        !error && <p className="text-muted">{tc("loading")}</p>
      ) : calls.length === 0 ? (
        query || flag || status || mine || review ? (
          <p className="text-muted">{t("noMatch")}</p>
        ) : (
          <EmptyState title={t("emptyTitle")}>
            {canRecord
              ? t.rich("emptyRecord", {
                  link: (chunks) => (
                    <Link
                      href="/samtaler/opptak"
                      className="font-semibold text-brand"
                    >
                      {chunks}
                    </Link>
                  ),
                })
              : t("emptyView")}
          </EmptyState>
        )
      ) : (
        <CallList calls={calls} />
      )}
      {calls?.length === 200 && (
        <p className="text-sm text-muted">{t("limit")}</p>
      )}
    </section>
  );
}
