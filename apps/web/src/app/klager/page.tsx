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
import { FoundCall, ReferenceLookup } from "@/components/work/reference-lookup";
import { NoAccess, useWorkMe } from "@/components/work/work-shell";
import {
  type CallLookup,
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
  const [found, setFound] = useState<CallLookup | null>(null);
  // The call a new complaint is about, when it was fetched by its reference.
  const [call, setCall] = useState<CallLookup["call"] | null>(null);
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
            className={secondaryButton}
            onClick={() => {
              setCall(null);
              setCreating(true);
            }}
          >
            {t("new")}
          </button>
        )}
      </div>

      {!creating && (
        <Card title={t("lookup.title")}>
          <div className="flex flex-col gap-4">
            <p className="text-muted">{t("lookup.intro")}</p>
            <ReferenceLookup
              label={t("lookup.label")}
              submit={t("lookup.find")}
              onFound={setFound}
            />
            {found && (
              <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
                <p className="font-mono font-semibold">
                  {found.call.reference}
                </p>
                <FoundCall call={found.call} />
                {found.complaints.length ? (
                  <div>
                    <p className="text-sm font-semibold text-muted">
                      {t("lookup.existing")}
                    </p>
                    <ul className="mt-1 flex flex-col gap-1">
                      {found.complaints.map((k) => (
                        <li
                          key={k.id}
                          className="flex flex-wrap items-center gap-3"
                        >
                          <Link
                            href={`/klager/${k.id}`}
                            className="inline-flex min-h-11 items-center font-semibold text-brand"
                          >
                            {k.summary}
                          </Link>
                          <ComplaintStatusBadge status={k.status} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p>{t("lookup.none")}</p>
                )}
                <div>
                  <button
                    type="button"
                    className={primaryButton}
                    onClick={() => {
                      setCall(found.call);
                      setCreating(true);
                    }}
                  >
                    {t("lookup.newOnCall")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {creating && (
        <NewComplaint
          customerId={preselected}
          call={call}
          canPickCustomer={me?.permissions.includes("customers.read") ?? false}
          onCancel={() => {
            setCreating(false);
            setCall(null);
          }}
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
                    {k.customerName ??
                      (k.callReference
                        ? t("callRef", { reference: k.callReference })
                        : t("customer"))}
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
  call,
  canPickCustomer,
  onCancel,
}: {
  customerId: string | null;
  // A complaint about a call needs no customer; one can be picked if the call has none.
  call: CallLookup["call"] | null;
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
          customerId: customer?.id ?? null,
          callId: call?.id ?? null,
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
      {!call && !canPickCustomer ? (
        <p>{t("newComplaint.needCustomers")}</p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          {call && (
            <div>
              <p className="text-sm font-semibold text-muted">
                {t("newComplaint.call")}
              </p>
              <p className="font-mono font-semibold">{call.reference}</p>
              <FoundCall call={call} />
            </div>
          )}
          {call?.customerName ? (
            <div>
              <p className="text-sm font-semibold text-muted">
                {t("customer")}
              </p>
              <p>
                {t("newComplaint.customerFromCall", {
                  name: call.customerName,
                })}
              </p>
            </div>
          ) : call && !call.customerId && canPickCustomer ? (
            <div>
              <p className="text-sm font-semibold">
                {t("newComplaint.customerOptional")}
              </p>
              <CustomerPicker
                value={customer}
                onChange={pick}
                hint={t("newComplaint.customerOptionalHint")}
              />
            </div>
          ) : !call ? (
            <CustomerPicker
              value={customer}
              onChange={pick}
              hint={t("newComplaint.customerHint")}
            />
          ) : null}
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
            hint={
              call
                ? t("newComplaint.descriptionCallHint")
                : t("newComplaint.descriptionHint")
            }
          >
            <textarea
              rows={call ? 6 : 4}
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
              disabled={busy || (!customer && !call) || !summary.trim()}
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
