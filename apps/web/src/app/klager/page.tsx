"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import {
  ErrorMessage,
  Field,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/components/admin/field";
import { ComplaintStatusBadge } from "@/components/work/complaint-status";
import { CustomerPicker } from "@/components/work/customer-picker";
import { NoAccess, useWorkMe } from "@/components/work/work-shell";
import {
  type Channel,
  type ComplaintStatus,
  type ComplaintSummary,
} from "@/lib/complaints";
import { formatDate } from "@/lib/format";
import { orgFetch } from "@/lib/org";
import type { Customer, SaleSummary } from "@/lib/work";

const STATUSES: ComplaintStatus[] = [
  "open",
  "investigating",
  "resolved",
  "rejected",
];
const CHANNELS: Channel[] = ["phone", "email", "letter", "web", "other"];

export default function ComplaintsPage() {
  const me = useWorkMe();
  const t = useTranslations("complaints");
  const td = useTranslations("domain");
  const tc = useTranslations("common");
  const allowed = me?.permissions.includes("complaints.manage") ?? false;
  // From the customer page: /klager?kunde=<id> opens a new complaint for that customer.
  const [preselected] = useState(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("kunde"),
  );
  const [creating, setCreating] = useState(Boolean(preselected));
  const [filter, setFilter] = useState("open");
  const [complaints, setComplaints] = useState<ComplaintSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    const params =
      filter === "open" ? "?open=1" : filter ? `?status=${filter}` : "";
    orgFetch<ComplaintSummary[]>(`/complaints${params}`)
      .then((rows) => {
        if (cancelled) return;
        setComplaints(rows);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [filter, allowed]);

  if (!allowed) return <NoAccess text={t("noAccess")} />;

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            {t("title")}
          </h1>
          <p className="mt-2 text-muted">{t("intro")}</p>
        </div>
        {!creating && (
          <button
            type="button"
            className={primaryButton}
            onClick={() => setCreating(true)}
          >
            {t("new")}
          </button>
        )}
      </div>

      {creating && (
        <NewComplaint
          customerId={preselected}
          canPickCustomer={me?.permissions.includes("customers.read") ?? false}
          onCancel={() => setCreating(false)}
        />
      )}

      <Field label={t("show")}>
        <select
          className={`${inputClass} sm:w-64`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="open">{t("openCases")}</option>
          <option value="">{t("all")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {td(`complaintStatus.${s}`)}
            </option>
          ))}
        </select>
      </Field>

      <ErrorMessage message={error} />
      {!complaints ? (
        !error && <p className="text-muted">{tc("loading")}</p>
      ) : complaints.length === 0 ? (
        <p className="text-muted">
          {filter === "open" ? t("noneOpen") : t("noMatch")}
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {complaints.map((k) => (
            <li key={k.id}>
              <Link
                href={`/klager/${k.id}`}
                className="flex flex-col gap-1 p-4 hover:bg-bg sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold [overflow-wrap:anywhere]">
                    {k.summary}
                  </p>
                  <p className="text-sm text-muted">
                    {k.customerName ?? t("customer")}
                    {k.productName && ` · ${k.productName}`} ·{" "}
                    {t("received", {
                      channel: td(`channel.${k.channel}`),
                      date: formatDate(k.receivedOn),
                    })}
                    {k.assignedName && ` · ${k.assignedName}`}
                  </p>
                </div>
                <ComplaintStatusBadge status={k.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {complaints?.length === 200 && (
        <p className="text-sm text-muted">{t("limit")}</p>
      )}
    </section>
  );
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function NewComplaint({
  customerId,
  canPickCustomer,
  onCancel,
}: {
  customerId: string | null;
  canPickCustomer: boolean;
  onCancel: () => void;
}) {
  const router = useRouter();
  const t = useTranslations("complaints");
  const td = useTranslations("domain");
  const tw = useTranslations("work");
  const tc = useTranslations("common");
  const [customer, setCustomer] = useState<Pick<
    Customer,
    "id" | "name"
  > | null>(null);
  const [sales, setSales] = useState<SaleSummary[] | null>(null);
  const [saleId, setSaleId] = useState("");
  const [channel, setChannel] = useState<Channel>("phone");
  const [received, setReceived] = useState(today);
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!customerId || !canPickCustomer) return;
    let cancelled = false;
    orgFetch<Customer>(`/customers/${encodeURIComponent(customerId)}`)
      .then((c) => !cancelled && setCustomer(c))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [customerId, canPickCustomer]);

  // The customer's sales that the case handler can see, to pick the one the complaint is about.
  useEffect(() => {
    if (!customer) return;
    let cancelled = false;
    orgFetch<SaleSummary[]>(`/sales?customerId=${customer.id}`)
      .then((rows) => !cancelled && setSales(rows))
      .catch(() => !cancelled && setSales([]));
    return () => {
      cancelled = true;
    };
  }, [customer]);

  function pick(c: Pick<Customer, "id" | "name"> | null) {
    setCustomer(c);
    setSales(null);
    setSaleId("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { id } = await orgFetch<{ id: string }>("/complaints", {
        method: "POST",
        body: {
          customerId: customer?.id,
          saleId: saleId || null,
          channel,
          receivedOn: received,
          summary: summary.trim(),
          description: description.trim(),
        },
      });
      router.push(`/klager/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card title={t("new")}>
      {!canPickCustomer ? (
        <p>{t("newComplaint.needCustomers")}</p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <CustomerPicker
            value={customer}
            onChange={pick}
            hint={t("newComplaint.customerHint")}
          />
          {customer && (
            <Field
              label={t("newComplaint.sale")}
              hint={t("newComplaint.saleHint")}
            >
              <select
                className={`${inputClass} sm:max-w-md`}
                value={saleId}
                onChange={(e) => setSaleId(e.target.value)}
              >
                <option value="">
                  {sales === null ? tc("loading") : t("newComplaint.noSale")}
                </option>
                {sales?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {t("newComplaint.saleOption", {
                      product: s.productName,
                      date: formatDate(s.soldAt),
                    })}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2 sm:max-w-md">
            <Field label={t("newComplaint.channel")}>
              <select
                className={inputClass}
                value={channel}
                onChange={(e) => setChannel(e.target.value as Channel)}
              >
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {td(`channel.${c}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("newComplaint.received")}>
              <input
                type="date"
                required
                max={today()}
                className={inputClass}
                value={received}
                onChange={(e) => setReceived(e.target.value)}
              />
            </Field>
          </div>
          <Field label={t("newComplaint.summary")}>
            <input
              required
              maxLength={200}
              className={`${inputClass} sm:max-w-xl`}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </Field>
          <Field
            label={t("newComplaint.description")}
            hint={t("newComplaint.descriptionHint")}
          >
            <textarea
              rows={4}
              maxLength={10000}
              className={`${inputClass} py-2`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <ErrorMessage message={error} />
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy || !customer || !summary.trim()}
              className={primaryButton}
            >
              {t("newComplaint.submit")}
            </button>
            <button
              type="button"
              className={secondaryButton}
              onClick={onCancel}
            >
              {tw("cancel")}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
