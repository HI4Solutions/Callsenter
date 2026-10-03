"use client";

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
import { EconomyNav } from "@/components/billing/economy-nav";
import {
  type EditableLine,
  emptyLine,
  LinesEditor,
} from "@/components/billing/lines-editor";
import {
  osloToday,
  useInvoiceForm,
} from "@/components/billing/use-invoice-form";
import { adminFetch, formatDate } from "@/lib/admin";
import { INTERVAL, kr, type RecurringInvoice } from "@/lib/billing";

const INTERVALS = Object.keys(
  INTERVAL,
) as `${RecurringInvoice["intervalMonths"]}`[];

// Fixed agreements: sent automatically every morning a set number of days before they fall due.
export default function RecurringPage() {
  const t = useTranslations("economy");
  const ti = useTranslations("domain.interval");
  const tc = useTranslations("common");
  const [agreements, setAgreements] = useState<RecurringInvoice[] | null>(null);
  const [editing, setEditing] = useState<RecurringInvoice | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      adminFetch<RecurringInvoice[]>("/recurring-invoices")
        .then(setAgreements)
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    adminFetch<RecurringInvoice[]>("/recurring-invoices")
      .then((rows) => !cancelled && setAgreements(rows))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  async function runNow() {
    if (!window.confirm(t("recurring.confirmRun"))) return;
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const { sent, emailed } = await adminFetch<{
        sent: number;
        emailed: number;
      }>("/billing/run", { method: "POST" });
      setMessage(
        sent ? t("recurring.ran", { sent, emailed }) : t("recurring.nothing"),
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const today = osloToday();
  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted">{t("recurring.intro")}</p>
      </div>
      <EconomyNav />
      <div className="flex flex-wrap gap-2">
        {!editing && (
          <button
            type="button"
            className={primaryButton}
            onClick={() => setEditing("new")}
          >
            {t("recurring.new")}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          className={secondaryButton}
          onClick={runNow}
        >
          {t("recurring.runNow")}
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      <ErrorMessage message={error} />
      {editing && (
        <AgreementForm
          key={editing === "new" ? "new" : editing.id}
          agreement={editing === "new" ? null : editing}
          onDone={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
      {!agreements ? (
        !error && <p className="text-muted">{tc("loading")}</p>
      ) : agreements.length === 0 ? (
        <p className="text-muted">{t("recurring.empty")}</p>
      ) : (
        <div className="-mx-2 scroll-x">
          <table className="w-full min-w-[44rem] text-left">
            <thead className="text-sm text-muted">
              <tr>
                <th className="px-2 py-2 font-semibold">
                  {t("shared.customer")}
                </th>
                <th className="px-2 py-2 font-semibold">
                  {t("recurring.howOften")}
                </th>
                <th className="px-2 py-2 font-semibold">
                  {t("recurring.nextSend")}
                </th>
                <th className="px-2 py-2 font-semibold">
                  {t("recurring.nextDue")}
                </th>
                <th className="px-2 py-2 text-right font-semibold">
                  {t("recurring.amountExVat")}
                </th>
                <th className="px-2 py-2 font-semibold">
                  {t("recurring.status")}
                </th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {agreements.map((a) => (
                <tr key={a.id}>
                  <td className="px-2 py-3">
                    <span className="font-semibold">{a.organizationName}</span>
                    <span className="block text-sm text-muted">
                      {t("recurring.agreementLine", {
                        name: a.name,
                        number: a.customerNumber,
                      })}
                    </span>
                  </td>
                  <td className="px-2 py-3">{ti(`${a.intervalMonths}`)}</td>
                  <td className="px-2 py-3">
                    {a.sendDate <= today
                      ? t("recurring.today")
                      : formatDate(a.sendDate)}
                  </td>
                  <td className="px-2 py-3">{formatDate(a.nextDate)}</td>
                  <td className="px-2 py-3 text-right">
                    {kr(
                      a.lines.reduce(
                        (sum, l) => sum + l.quantity * l.unitPrice,
                        0,
                      ),
                    )}
                  </td>
                  <td className="px-2 py-3">
                    {!a.active
                      ? t("recurring.stopped")
                      : a.paused
                        ? t("recurring.paused")
                        : t("shared.active")}
                  </td>
                  <td className="px-2 py-3 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      {a.paused && (
                        <button
                          type="button"
                          className={secondaryButton}
                          onClick={async () => {
                            if (!window.confirm(t("recurring.confirmResume")))
                              return;
                            try {
                              await adminFetch(`/recurring-invoices/${a.id}`, {
                                method: "PATCH",
                                body: { paused: false },
                              });
                              await load();
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          {t("recurring.resume")}
                        </button>
                      )}
                      <button
                        type="button"
                        className={secondaryButton}
                        onClick={() => setEditing(a)}
                      >
                        {t("shared.edit")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AgreementForm({
  agreement,
  onDone,
}: {
  agreement: RecurringInvoice | null;
  onDone: () => Promise<void>;
}) {
  const t = useTranslations("economy");
  const ti = useTranslations("domain.interval");
  const tc = useTranslations("common");
  const { organizations, packages, settings } = useInvoiceForm();
  const [organizationId, setOrganizationId] = useState(
    agreement?.organizationId ?? "",
  );
  const [name, setName] = useState(
    agreement?.name ?? t("recurring.defaultName"),
  );
  const [interval, setIntervalMonths] = useState<number>(
    agreement?.intervalMonths ?? 1,
  );
  const [nextDate, setNextDate] = useState(agreement?.nextDate ?? "");
  const [daysBefore, setDaysBefore] = useState(
    agreement?.daysBefore === null || agreement?.daysBefore === undefined
      ? ""
      : String(agreement.daysBefore),
  );
  const [grantAccess, setGrantAccess] = useState(
    agreement?.grantAccess ?? true,
  );
  const [active, setActive] = useState(agreement?.active ?? true);
  const [lines, setLines] = useState<EditableLine[]>(
    agreement
      ? agreement.lines.map((l) => ({
          kind: l.kind ?? (l.packageId ? "package" : "text"),
          packageId: l.packageId ?? null,
          description: l.description,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          vatRate: l.vatRate,
        }))
      : [emptyLine()],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      await onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const body = {
    name,
    lines,
    intervalMonths: interval,
    ...(agreement && nextDate === agreement.nextDate ? {} : { nextDate }),
    daysBefore: daysBefore === "" ? null : Number(daysBefore),
    grantAccess,
    active,
  };
  return (
    <Card
      title={
        agreement
          ? `${agreement.organizationName}: ${agreement.name}`
          : t("recurring.new")
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() =>
            agreement
              ? adminFetch(`/recurring-invoices/${agreement.id}`, {
                  method: "PATCH",
                  body,
                })
              : adminFetch("/recurring-invoices", {
                  method: "POST",
                  body: { ...body, organizationId, nextDate },
                }),
          );
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {!agreement && (
            <Field label={t("shared.customer")}>
              <select
                required
                className={inputClass}
                value={organizationId}
                onChange={(e) => setOrganizationId(e.target.value)}
              >
                <option value="">
                  {organizations ? t("shared.chooseCentre") : tc("loading")}
                </option>
                {organizations?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={t("shared.name")} hint={t("recurring.nameHint")}>
            <input
              required
              maxLength={200}
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label={t("recurring.howOften")}>
            <select
              className={inputClass}
              value={interval}
              onChange={(e) => setIntervalMonths(Number(e.target.value))}
            >
              {INTERVALS.map((k) => (
                <option key={k} value={k}>
                  {ti(k)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={t("recurring.nextDue")}
            hint={t("recurring.nextDueHint")}
          >
            <input
              required
              type="date"
              className={inputClass}
              value={nextDate}
              onChange={(e) => setNextDate(e.target.value)}
            />
          </Field>
          <Field
            label={t("recurring.daysBefore")}
            hint={t("recurring.daysBeforeHint", {
              days: settings?.recurringDaysBefore ?? 14,
            })}
          >
            <input
              type="number"
              min={0}
              max={60}
              className={inputClass}
              value={daysBefore}
              onChange={(e) => setDaysBefore(e.target.value)}
            />
          </Field>
        </div>
        <LinesEditor
          lines={lines}
          onChange={setLines}
          packages={packages}
          fee={settings?.invoiceFee}
        />
        <label className="inline-flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={grantAccess}
            onChange={(e) => setGrantAccess(e.target.checked)}
          />
          {t("recurring.grantAccess")}
        </label>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          {t("shared.active")}
        </label>
        <ErrorMessage message={error} />
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy || (!agreement && !organizationId)}
            className={primaryButton}
          >
            {t("shared.save")}
          </button>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => void onDone()}
          >
            {t("shared.cancel")}
          </button>
          {agreement && (
            <button
              type="button"
              disabled={busy}
              className={secondaryButton}
              onClick={() => {
                if (window.confirm(t("recurring.confirmDelete"))) {
                  void run(() =>
                    adminFetch(`/recurring-invoices/${agreement.id}`, {
                      method: "DELETE",
                    }),
                  );
                }
              }}
            >
              {t("shared.delete")}
            </button>
          )}
        </div>
      </form>
    </Card>
  );
}
