"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import {
  ErrorMessage,
  Field,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/components/admin/field";
import { formatDateTime } from "@/lib/format";
import {
  days,
  formatPrice,
  lines,
  months,
  priceInput,
  type RequiredPoint,
  type TemplateVersion,
} from "@/lib/work";

// A version as sellers and AI control see it.
export function VersionView({ version }: { version: TemplateVersion }) {
  const t = useTranslations("work.template");
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[12rem_1fr]">
        {(
          [
            [t("price"), formatPrice(version)],
            [t("binding"), months(version.bindingMonths)],
            [t("notice"), months(version.noticeMonths)],
            [t("withdrawal"), days(version.withdrawalDays)],
            ...(version.publishedAt
              ? [
                  [
                    t("published"),
                    version.publishedByName
                      ? t("publishedBy", {
                          date: formatDateTime(version.publishedAt),
                          name: version.publishedByName,
                        })
                      : formatDateTime(version.publishedAt),
                  ],
                ]
              : []),
          ] as [string, string][]
        ).map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-sm font-semibold text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <h3 className="font-bold">{t("requiredPoints")}</h3>
        <p className="text-sm text-muted">{t("requiredPointsIntro")}</p>
        {version.requiredPoints.length ? (
          <ol className="mt-2 list-decimal space-y-1 pl-6 [overflow-wrap:anywhere]">
            {version.requiredPoints.map((p) => (
              <li key={p.id}>{p.text}</li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-muted">{t("none")}</p>
        )}
      </div>
      <PhraseList
        title={t("approvedPhrases")}
        phrases={version.approvedPhrases}
      />
      <PhraseList
        title={t("forbiddenPhrases")}
        phrases={version.forbiddenPhrases}
      />
      <div>
        <h3 className="font-bold">{t("terms")}</h3>
        {version.terms ? (
          <p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] rounded-lg bg-bg p-3">
            {version.terms}
          </p>
        ) : (
          <p className="mt-2 text-muted">{t("noTerms")}</p>
        )}
      </div>
    </div>
  );
}

function PhraseList({ title, phrases }: { title: string; phrases: string[] }) {
  const t = useTranslations("work.template");
  return (
    <div>
      <h3 className="font-bold">{title}</h3>
      {phrases.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-6 [overflow-wrap:anywhere]">
          {phrases.map((p) => (
            <li key={p}>«{p}»</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-muted">{t("none")}</p>
      )}
    </div>
  );
}

function wholeNumber(value: string, message: string): number {
  if (!/^\d+$/.test(value.trim())) throw new Error(message);
  return Number(value);
}

// The draft editor. Points keep their ids, so AI findings on earlier versions still match.
export function DraftEditor({
  draft,
  onSave,
  onPublish,
  onDelete,
}: {
  draft: TemplateVersion;
  onSave: (
    body: Record<string, unknown>,
  ) => Promise<{ requiredPoints: RequiredPoint[] }>;
  onPublish: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const t = useTranslations("work.template");
  const tc = useTranslations("common");
  const [priceOnce, setPriceOnce] = useState(priceInput(draft.priceOnce));
  const [priceMonthly, setPriceMonthly] = useState(
    priceInput(draft.priceMonthly),
  );
  const [bindingMonths, setBindingMonths] = useState(
    String(draft.bindingMonths),
  );
  const [noticeMonths, setNoticeMonths] = useState(String(draft.noticeMonths));
  const [withdrawalDays, setWithdrawalDays] = useState(
    String(draft.withdrawalDays),
  );
  const [terms, setTerms] = useState(draft.terms);
  const [points, setPoints] = useState<RequiredPoint[]>(draft.requiredPoints);
  const [approved, setApproved] = useState(draft.approvedPhrases.join("\n"));
  const [forbidden, setForbidden] = useState(draft.forbiddenPhrases.join("\n"));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const form = useRef<HTMLFormElement>(null);

  // An empty number field is an error, never a silent 0 (a published version cannot be fixed).
  const body = () => ({
    priceOnce: priceOnce.trim() || null,
    priceMonthly: priceMonthly.trim() || null,
    bindingMonths: wholeNumber(
      bindingMonths,
      t("wholeNumber", { label: t("binding") }),
    ),
    noticeMonths: wholeNumber(
      noticeMonths,
      t("wholeNumber", { label: t("notice") }),
    ),
    withdrawalDays: wholeNumber(
      withdrawalDays,
      t("wholeNumber", { label: t("withdrawal") }),
    ),
    terms,
    requiredPoints: points.filter((p) => p.text.trim()),
    approvedPhrases: lines(approved),
    forbiddenPhrases: lines(forbidden),
  });

  async function run(action: () => Promise<void>) {
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const edit =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setSaved(false);
      setter(v);
    };

  return (
    <form
      ref={form}
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          // New points get their ids from the server; keep them so the next save does not renumber.
          setPoints((await onSave(body())).requiredPoints);
          setSaved(true);
        });
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t("priceMonthly")} hint={t("priceMonthlyHint")}>
          <input
            inputMode="decimal"
            className={inputClass}
            value={priceMonthly}
            onChange={(e) => edit(setPriceMonthly)(e.target.value)}
          />
        </Field>
        <Field label={t("priceOnce")} hint={t("priceOnceHint")}>
          <input
            inputMode="decimal"
            className={inputClass}
            value={priceOnce}
            onChange={(e) => edit(setPriceOnce)(e.target.value)}
          />
        </Field>
        <Field label={t("bindingMonths")}>
          <input
            type="number"
            required
            min={0}
            max={120}
            className={inputClass}
            value={bindingMonths}
            onChange={(e) => edit(setBindingMonths)(e.target.value)}
          />
        </Field>
        <Field label={t("noticeMonths")}>
          <input
            type="number"
            required
            min={0}
            max={24}
            className={inputClass}
            value={noticeMonths}
            onChange={(e) => edit(setNoticeMonths)(e.target.value)}
          />
        </Field>
        <Field label={t("withdrawalDays")} hint={t("withdrawalDaysHint")}>
          <input
            type="number"
            required
            min={0}
            max={365}
            className={inputClass}
            value={withdrawalDays}
            onChange={(e) => edit(setWithdrawalDays)(e.target.value)}
          />
        </Field>
      </div>

      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="font-bold">{t("requiredPoints")}</legend>
        <p className="text-sm text-muted">{t("requiredPointsHint")}</p>
        {points.map((p, i) => (
          <div key={p.id || `ny-${i}`} className="flex gap-2">
            <label className="sr-only" htmlFor={`point-${i}`}>
              {t("point", { number: i + 1 })}
            </label>
            <input
              id={`point-${i}`}
              maxLength={500}
              className={`${inputClass} min-w-0 flex-1`}
              value={p.text}
              onChange={(e) =>
                edit(setPoints)(
                  points.map((q, j) =>
                    j === i ? { ...q, text: e.target.value } : q,
                  ),
                )
              }
            />
            <button
              type="button"
              className={secondaryButton}
              onClick={() => edit(setPoints)(points.filter((_, j) => j !== i))}
            >
              {tc("remove")}
              <span className="sr-only">
                {" "}
                {t("removePoint", { number: i + 1 })}
              </span>
            </button>
          </div>
        ))}
        <div>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => edit(setPoints)([...points, { id: "", text: "" }])}
          >
            {t("addPoint")}
          </button>
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Field label={t("approvedPhrases")} hint={t("approvedHint")}>
          <textarea
            rows={5}
            className={`${inputClass} py-2`}
            value={approved}
            onChange={(e) => edit(setApproved)(e.target.value)}
          />
        </Field>
        <Field label={t("forbiddenPhrases")} hint={t("forbiddenHint")}>
          <textarea
            rows={5}
            className={`${inputClass} py-2`}
            value={forbidden}
            onChange={(e) => edit(setForbidden)(e.target.value)}
          />
        </Field>
      </div>

      <Field label={t("terms")} hint={t("termsHint")}>
        <textarea
          rows={10}
          maxLength={50000}
          className={`${inputClass} py-2`}
          value={terms}
          onChange={(e) => edit(setTerms)(e.target.value)}
        />
      </Field>

      <ErrorMessage message={error} />
      {saved && (
        <p role="status" className="text-muted">
          {t("saved")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={primaryButton}>
          {t("saveDraft")}
        </button>
        <button
          type="button"
          disabled={busy}
          className={secondaryButton}
          onClick={() => {
            if (!form.current?.reportValidity()) return;
            if (
              !window.confirm(t("publishConfirm", { version: draft.version }))
            )
              return;
            void run(async () => {
              await onSave(body());
              await onPublish();
            });
          }}
        >
          {t("saveAndPublish")}
        </button>
        {/* Away from the save buttons, and quieter, since it throws the work away. */}
        <button
          type="button"
          disabled={busy}
          className="inline-flex min-h-11 items-center px-2 font-semibold text-muted underline-offset-4 hover:text-fg hover:underline disabled:opacity-60 sm:ml-auto"
          onClick={() => {
            if (window.confirm(t("deleteConfirm"))) void run(onDelete);
          }}
        >
          {t("deleteDraft")}
        </button>
      </div>
    </form>
  );
}
