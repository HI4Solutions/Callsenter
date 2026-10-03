"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import {
  ErrorMessage,
  Field,
  inputClass,
  primaryButton,
  secondaryButton,
  LoadState,
} from "@/components/admin/field";
import { EconomyNav } from "@/components/billing/economy-nav";
import {
  InvoiceStatusBadge,
  useInvoiceTitle,
} from "@/components/billing/invoice-status";
import { InvoiceView } from "@/components/billing/invoice-view";
import {
  type EditableLine,
  LinesEditor,
} from "@/components/billing/lines-editor";
import {
  osloToday,
  useInvoiceForm,
} from "@/components/billing/use-invoice-form";
import { adminFetch, formatDate, formatDateTime } from "@/lib/admin";
import { type InvoiceDetail, kr, openPdf, PAYMENT_METHOD } from "@/lib/billing";

function lastMonth() {
  const [y, m] = osloToday().split("-").map(Number);
  return m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`;
}

export default function InvoicePage() {
  const t = useTranslations("economy");
  const invoiceTitle = useInvoiceTitle();
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminFetch<InvoiceDetail>(`/invoices/${id}`)
      .then((i) => !cancelled && setInvoice(i))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!invoice) return <LoadState error={error} />;
  const editable = invoice.status === "draft" || invoice.status === "scheduled";

  function changed(
    next: InvoiceDetail & { emailed?: boolean },
    message?: string,
  ) {
    setInvoice(next);
    setNotice(message ?? null);
  }

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-6 print:hidden">
        <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
        <EconomyNav />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <Link
            href="/admin/okonomi/faktura"
            className="inline-flex min-h-11 items-center text-sm font-semibold text-brand"
          >
            {t("invoice.allInvoices")}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-extrabold tracking-tight">
              {invoiceTitle(invoice)}
            </h2>
            <InvoiceStatusBadge invoice={invoice} />
          </div>
          <p className="mt-1 text-muted">
            {t("invoice.customerLine", {
              name: invoice.organizationName,
              number: invoice.customerNumber,
            })}
          </p>
        </div>
        <button
          type="button"
          className={secondaryButton}
          onClick={() =>
            openPdf(
              `/admin/invoices/${invoice.id}/pdf`,
              t("shared.pdfFailed"),
            ).catch((e: Error) => setError(e.message))
          }
        >
          {editable ? t("invoice.previewPdf") : t("invoice.downloadPdf")}
        </button>
      </div>
      {notice && (
        <p role="status" className="rounded-lg bg-bg p-3">
          {notice}
        </p>
      )}
      <ErrorMessage message={error} />
      {editable ? (
        <Draft
          key={`${invoice.status}-${invoice.lines.map((l) => l.id).join()}`}
          invoice={invoice}
          onChanged={changed}
        />
      ) : (
        <Sent invoice={invoice} onChanged={changed} />
      )}
      <InvoiceView invoice={invoice} />
    </section>
  );
}

function Draft({
  invoice,
  onChanged,
}: {
  invoice: InvoiceDetail;
  onChanged: (
    i: InvoiceDetail & { emailed?: boolean },
    message?: string,
  ) => void;
}) {
  const t = useTranslations("economy");
  const router = useRouter();
  const { packages, settings } = useInvoiceForm();
  const [lines, setLines] = useState<EditableLine[]>(() =>
    invoice.lines.length
      ? invoice.lines.map((l) => ({
          kind: l.kind,
          packageId: l.packageId,
          description: l.description,
          quantity: l.quantity.replace(/\.?0+$/, ""),
          unitPrice: l.unitPrice,
          vatRate: l.vatRate,
        }))
      : [
          {
            kind: "text",
            packageId: null,
            description: "",
            quantity: "1",
            unitPrice: "",
            vatRate: 0.25,
          },
        ],
  );
  const [note, setNote] = useState(invoice.note ?? "");
  const [issueDate, setIssueDate] = useState(invoice.issueDate ?? osloToday());
  const [dueDate, setDueDate] = useState(invoice.dueDate ?? "");
  const [grantAccess, setGrantAccess] = useState(invoice.grantAccess);
  const [periodStart, setPeriodStart] = useState(invoice.periodStart ?? "");
  const [periodEnd, setPeriodEnd] = useState(invoice.periodEnd ?? "");
  const [month, setMonth] = useState(lastMonth);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const future = issueDate > osloToday();

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const save = () =>
    adminFetch<InvoiceDetail>(`/invoices/${invoice.id}`, {
      method: "PATCH",
      body: {
        note: note.trim() || null,
        lines,
        issueDate: future ? issueDate : null,
        dueDate: dueDate || null,
        grantAccess,
        periodStart: grantAccess ? periodStart || null : null,
        periodEnd: grantAccess ? periodEnd || null : null,
      },
    });

  return (
    <Card
      title={
        invoice.status === "scheduled"
          ? t("invoice.scheduledTitle", { date: formatDate(invoice.issueDate) })
          : t("invoice.draft")
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => onChanged(await save(), t("shared.saved")));
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("shared.invoiceDate")} hint={t("invoice.issueHint")}>
            <input
              type="date"
              min={osloToday()}
              className={inputClass}
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
          </Field>
          <Field
            label={t("shared.dueDate")}
            hint={t("shared.dueHint", { days: settings?.dueDays ?? 14 })}
          >
            <input
              type="date"
              min={osloToday()}
              className={inputClass}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
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
          {t("invoice.grantAccess")}
        </label>
        {grantAccess && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t("invoice.periodFrom")}
              hint={t("invoice.periodFromHint")}
            >
              <input
                type="date"
                className={inputClass}
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </Field>
            <Field
              label={t("invoice.periodTo")}
              hint={t("invoice.periodToHint")}
            >
              <input
                type="date"
                className={inputClass}
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
              />
            </Field>
          </div>
        )}
        <Field label={t("shared.note")} hint={t("shared.noteHint")}>
          <textarea
            rows={2}
            maxLength={2000}
            className={`${inputClass} py-2`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <ErrorMessage message={error} />
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className={secondaryButton}>
            {t("shared.save")}
          </button>
          <button
            type="button"
            disabled={busy}
            className={primaryButton}
            onClick={() => {
              const question = future
                ? t("invoice.confirmSchedule", { date: formatDate(issueDate) })
                : t("invoice.confirmSend");
              if (!window.confirm(question)) return;
              void run(async () => {
                await save();
                const sent = await adminFetch<
                  InvoiceDetail & { emailed: boolean }
                >(`/invoices/${invoice.id}/send`, { method: "POST" });
                onChanged(
                  sent,
                  sent.status === "scheduled"
                    ? t("invoice.scheduled", {
                        date: formatDate(sent.issueDate),
                      })
                    : sent.emailed
                      ? t("invoice.emailedTo", {
                          email: sent.recipient?.email ?? "",
                        })
                      : t("invoice.sentNoEmail"),
                );
              });
            }}
          >
            {future ? t("invoice.saveAndSchedule") : t("invoice.saveAndSend")}
          </button>
          {invoice.status === "scheduled" && (
            <button
              type="button"
              disabled={busy}
              className={secondaryButton}
              onClick={() =>
                run(async () =>
                  onChanged(
                    await adminFetch<InvoiceDetail>(
                      `/invoices/${invoice.id}/unschedule`,
                      { method: "POST" },
                    ),
                    t("invoice.unscheduled"),
                  ),
                )
              }
            >
              {t("invoice.unschedule")}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            className={secondaryButton}
            onClick={() => {
              if (!window.confirm(t("invoice.confirmDelete"))) return;
              void run(async () => {
                await adminFetch(`/invoices/${invoice.id}`, {
                  method: "DELETE",
                });
                router.push("/admin/okonomi/faktura");
              });
            }}
          >
            {t("shared.delete")}
          </button>
        </div>
      </form>
      <div className="mt-6 flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <Field
          label={t("invoice.usageMonth")}
          hint={t("invoice.usageMonthHint")}
        >
          <input
            type="month"
            className={inputClass}
            value={month}
            max={osloToday().slice(0, 7)}
            onChange={(e) => setMonth(e.target.value)}
          />
        </Field>
        <button
          type="button"
          disabled={busy || !month}
          className={secondaryButton}
          onClick={() =>
            run(async () => {
              await save();
              onChanged(
                await adminFetch<InvoiceDetail>(
                  `/invoices/${invoice.id}/usage`,
                  { method: "POST", body: { month } },
                ),
              );
            })
          }
        >
          {t("invoice.addUsage")}
        </button>
      </div>
    </Card>
  );
}

function Sent({
  invoice,
  onChanged,
}: {
  invoice: InvoiceDetail;
  onChanged: (i: InvoiceDetail, message?: string) => void;
}) {
  const t = useTranslations("economy");
  const tm = useTranslations("domain.paymentMethod");
  const router = useRouter();
  const outstanding = Number(invoice.total) - Number(invoice.paid);
  const [amount, setAmount] = useState(
    outstanding > 0 ? outstanding.toFixed(2).replace(".", ",") : "",
  );
  const [paidOn, setPaidOn] = useState(osloToday);
  const [method, setMethod] = useState<keyof typeof PAYMENT_METHOD>("bank");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [crediting, setCrediting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const canPay =
    invoice.kind === "invoice" &&
    (invoice.status === "sent" || invoice.status === "payment_missed");
  const canCredit =
    invoice.kind === "invoice" &&
    ["sent", "paid", "payment_missed"].includes(invoice.status);

  return (
    <Card title={t("invoice.paymentTitle")}>
      <div className="flex flex-col gap-4 print:hidden">
        {invoice.status === "payment_missed" && (
          <p>
            {t.rich("invoice.missed", {
              time: invoice.missedAt ? formatDateTime(invoice.missedAt) : "",
              b: (c) => <strong>{c}</strong>,
            })}
          </p>
        )}
        {invoice.grantAccess && invoice.periodStart && (
          <p className="text-sm text-muted">
            {t("invoice.grantsAccess", {
              from: formatDate(invoice.periodStart),
              to: formatDate(invoice.periodEnd),
            })}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {invoice.recipient?.email ? (
            <button
              type="button"
              disabled={busy}
              className={secondaryButton}
              onClick={() => {
                if (
                  !window.confirm(
                    t("invoice.confirmEmailAgain", {
                      email: invoice.recipient?.email ?? "",
                    }),
                  )
                )
                  return;
                void run(async () =>
                  onChanged(
                    await adminFetch<InvoiceDetail>(
                      `/invoices/${invoice.id}/email`,
                      { method: "POST" },
                    ),
                    t("invoice.emailed"),
                  ),
                );
              }}
            >
              {invoice.emails.length
                ? t("invoice.emailAgain")
                : t("invoice.email")}
            </button>
          ) : (
            <p className="text-sm text-muted">{t("invoice.noEmail")}</p>
          )}
          {invoice.emails.map((e) => (
            <span key={e.sentAt} className="text-sm text-muted">
              {t("invoice.sentTo", {
                email: e.sentTo,
                time: formatDateTime(e.sentAt),
              })}
            </span>
          ))}
        </div>
        {invoice.creditNote && (
          <p>
            {t.rich("invoice.creditedWith", {
              number: invoice.creditNote.number,
              link: (c) => (
                <Link
                  href={`/admin/okonomi/faktura/${invoice.creditNote!.id}`}
                  className="font-semibold text-brand"
                >
                  {c}
                </Link>
              ),
            })}
          </p>
        )}
        {invoice.kind === "credit" && invoice.creditOf && (
          <p>
            {t.rich("invoice.credits", {
              number: invoice.creditOfNumber ?? "",
              link: (c) => (
                <Link
                  href={`/admin/okonomi/faktura/${invoice.creditOf}`}
                  className="font-semibold text-brand"
                >
                  {c}
                </Link>
              ),
            })}
          </p>
        )}
        {invoice.payments.length > 0 && (
          <ul className="divide-y divide-line">
            {invoice.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap gap-3 py-2">
                <span className="font-semibold">{kr(p.amount)}</span>
                <span className="text-muted">
                  {formatDate(p.paidOn)} · {tm(p.method)}
                  {p.reference && ` · ${p.reference}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canPay && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                onChanged(
                  await adminFetch<InvoiceDetail>(
                    `/invoices/${invoice.id}/payments`,
                    {
                      method: "POST",
                      body: {
                        amount,
                        paidOn,
                        method,
                        reference: reference.trim() || null,
                      },
                    },
                  ),
                  t("invoice.paymentRegistered"),
                );
                setReference("");
              });
            }}
            className="grid gap-3 sm:grid-cols-2 sm:items-end xl:grid-cols-[8rem_10rem_8rem_minmax(0,1fr)_auto]"
          >
            <Field label={t("invoice.amount")}>
              <input
                required
                inputMode="decimal"
                className={inputClass}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label={t("invoice.paidOn")}>
              <input
                required
                type="date"
                max={osloToday()}
                className={inputClass}
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
              />
            </Field>
            <Field label={t("invoice.method")}>
              <select
                className={inputClass}
                value={method}
                onChange={(e) =>
                  setMethod(e.target.value as keyof typeof PAYMENT_METHOD)
                }
              >
                {(
                  Object.keys(PAYMENT_METHOD) as (keyof typeof PAYMENT_METHOD)[]
                ).map((k) => (
                  <option key={k} value={k}>
                    {tm(k)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("invoice.reference")}>
              <input
                maxLength={200}
                className={inputClass}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
            <button type="submit" disabled={busy} className={primaryButton}>
              {t("invoice.registerPayment")}
            </button>
          </form>
        )}
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          {invoice.status === "sent" && invoice.kind === "invoice" && (
            <button
              type="button"
              disabled={busy}
              className={secondaryButton}
              onClick={() => {
                if (!window.confirm(t("invoice.confirmMissed"))) return;
                void run(async () =>
                  onChanged(
                    await adminFetch<InvoiceDetail>(
                      `/invoices/${invoice.id}/missed`,
                      { method: "POST" },
                    ),
                    t("invoice.markedMissed"),
                  ),
                );
              }}
            >
              {t("invoice.paymentMissed")}
            </button>
          )}
          {canCredit && !crediting && (
            <button
              type="button"
              className={secondaryButton}
              onClick={() => setCrediting(true)}
            >
              {t("invoice.credit")}
            </button>
          )}
        </div>
        {crediting && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!window.confirm(t("invoice.confirmCredit"))) return;
              void run(async () => {
                const { id } = await adminFetch<{ id: string }>(
                  `/invoices/${invoice.id}/credit`,
                  { method: "POST", body: { reason: reason.trim() || null } },
                );
                router.push(`/admin/okonomi/faktura/${id}`);
              });
            }}
            className="flex flex-col gap-3"
          >
            <Field
              label={t("invoice.creditReason")}
              hint={t("invoice.creditReasonHint")}
            >
              <input
                maxLength={2000}
                className={inputClass}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={busy} className={primaryButton}>
                {t("invoice.makeCredit")}
              </button>
              <button
                type="button"
                className={secondaryButton}
                onClick={() => setCrediting(false)}
              >
                {t("shared.cancel")}
              </button>
            </div>
          </form>
        )}
        <ErrorMessage message={error} />
      </div>
    </Card>
  );
}
