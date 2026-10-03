"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { EconomyNav } from "@/components/billing/economy-nav";
import {
  InvoiceStatusBadge,
  useInvoiceTitle,
} from "@/components/billing/invoice-status";
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
import { type InvoiceSummary, kr } from "@/lib/billing";

export default function InvoicesPage() {
  const t = useTranslations("economy");
  const ts = useTranslations("domain.invoiceStatus");
  const tc = useTranslations("common");
  const invoiceTitle = useInvoiceTitle();
  const [status, setStatus] = useState("");
  // From Kunder: /admin/okonomi/faktura?kunde=<id> shows one call centre's invoices.
  const [customer] = useState(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("kunde"),
  );
  const [invoices, setInvoices] = useState<InvoiceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (customer) params.set("organizationId", customer);
    adminFetch<InvoiceSummary[]>(`/invoices${params.size ? `?${params}` : ""}`)
      .then((rows) => {
        if (cancelled) return;
        setInvoices(rows);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [status, customer]);

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted">{t("invoices.intro")}</p>
      </div>
      <EconomyNav />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Field label={t("invoices.show")}>
          <select
            className={`${inputClass} sm:w-64`}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">{t("invoices.all")}</option>
            <option value="draft">{ts("draft")}</option>
            <option value="scheduled">{ts("scheduled")}</option>
            <option value="sent">{t("invoices.sentUnpaid")}</option>
            <option value="overdue">{t("shared.overdue")}</option>
            <option value="payment_missed">{ts("payment_missed")}</option>
            <option value="paid">{ts("paid")}</option>
            <option value="credited">{ts("credited")}</option>
          </select>
        </Field>
        {!creating && (
          <button
            type="button"
            className={primaryButton}
            onClick={() => setCreating(true)}
          >
            {t("invoices.new")}
          </button>
        )}
      </div>
      {creating && <NewInvoice onCancel={() => setCreating(false)} />}
      <ErrorMessage message={error} />
      {!invoices ? (
        !error && <p className="text-muted">{tc("loading")}</p>
      ) : invoices.length === 0 ? (
        <p className="text-muted">{t("invoices.empty")}</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {invoices.map((i) => (
            <li key={i.id}>
              <Link
                href={`/admin/okonomi/faktura/${i.id}`}
                className="flex flex-col gap-1 p-4 hover:bg-bg sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {invoiceTitle(i)} · {i.organizationName}
                  </p>
                  <p className="text-sm text-muted">
                    {t("invoices.customerNumber", { number: i.customerNumber })}{" "}
                    ·{" "}
                    {i.status === "scheduled"
                      ? t("invoices.sendsOn", { date: formatDate(i.issueDate) })
                      : i.status === "draft"
                        ? t("invoices.createdOn", {
                            date: formatDate(i.createdAt),
                          })
                        : t("invoices.sentOn", {
                            date: formatDate(i.issueDate),
                          })}
                    {i.dueDate &&
                      i.kind === "invoice" &&
                      i.status !== "draft" &&
                      t("invoices.dueOn", { date: formatDate(i.dueDate) })}
                    {i.grantAccess &&
                      i.periodEnd &&
                      t("invoices.accessUntil", {
                        date: formatDate(i.periodEnd),
                      })}
                  </p>
                </div>
                <span className="font-semibold">{kr(i.total)}</span>
                <InvoiceStatusBadge invoice={i} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NewInvoice({ onCancel }: { onCancel: () => void }) {
  const t = useTranslations("economy");
  const tc = useTranslations("common");
  const router = useRouter();
  const {
    organizations,
    packages,
    settings,
    error: loadError,
  } = useInvoiceForm();
  const [organizationId, setOrganizationId] = useState("");
  const [issueDate, setIssueDate] = useState(osloToday);
  const [dueDate, setDueDate] = useState("");
  const [grantAccess, setGrantAccess] = useState(true);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<EditableLine[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { id } = await adminFetch<{ id: string }>("/invoices", {
        method: "POST",
        body: {
          organizationId,
          issueDate: issueDate > osloToday() ? issueDate : null,
          dueDate: dueDate || null,
          grantAccess,
          note: note.trim() || null,
          lines,
        },
      });
      router.push(`/admin/okonomi/faktura/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card title={t("invoices.new")}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
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
          <Field label={t("shared.invoiceDate")} hint={t("invoices.issueHint")}>
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
          {t("invoices.grantAccess")}
        </label>
        <Field label={t("shared.note")} hint={t("shared.noteHint")}>
          <textarea
            rows={2}
            maxLength={2000}
            className={`${inputClass} py-2`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <ErrorMessage message={error ?? loadError} />
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy || !organizationId}
            className={primaryButton}
          >
            {t("invoices.saveDraft")}
          </button>
          <button type="button" className={secondaryButton} onClick={onCancel}>
            {t("shared.cancel")}
          </button>
        </div>
      </form>
    </Card>
  );
}
