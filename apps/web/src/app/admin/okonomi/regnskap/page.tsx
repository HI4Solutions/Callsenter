"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ColumnChart } from "@/components/admin/charts";
import {
  ErrorMessage,
  Field,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/components/admin/field";
import { EconomyNav } from "@/components/billing/economy-nav";
import { osloToday } from "@/components/billing/use-invoice-form";
import { adminFetch, formatDate, toCsv } from "@/lib/admin";
import { kr, percent, usd } from "@/lib/billing";
import { formatTagNow } from "@/lib/format";

interface Summary {
  from: string;
  to: string;
  costs: {
    ai: number;
    soniox: number;
    eid: number;
    manual: number;
    fixed: number;
    total: number;
  };
  revenue: {
    gross: number;
    vat: number;
    net: number;
    invoices: number;
    manual: number;
  };
  result: number;
  kpi: {
    mrr: number;
    arr: number;
    invoiceMrr: number;
    agreements: number;
    payingCustomers: number;
    trials: number;
  };
}

interface Month {
  month: string;
  revenue: number;
  costs: number;
  result: number;
}

interface ReportRow {
  month: string | null;
  // A package's name; the other rows have a productKey instead.
  product: string | null;
  productKey: "invoiceFee" | "otherLines" | "manualPayments" | null;
  quantity: number;
  net: number;
  vat: number;
  total: number;
}

interface Entry {
  id: string;
  kind: "cost" | "income";
  description: string;
  amount: string;
  currency: "NOK" | "USD";
  vatRate: number;
  occurredOn: string;
}

interface FixedCost {
  id: string;
  description: string;
  amount: string;
  currency: "NOK" | "USD";
  startsMonth: string;
  endsMonth: string | null;
}

const shift = (d: string, days: number) =>
  new Date(Date.parse(`${d}T12:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
const monthName = (m: string) =>
  new Intl.DateTimeFormat(formatTagNow(), {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`${m}-01T00:00:00Z`));

// The periods for the key figures. Opens on this month.
type PresetKey = "month" | "last-month" | "7" | "30" | "90" | "ytd";
function presets(today: string): { key: PresetKey; range: [string, string] }[] {
  const month = today.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const prev =
    m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`;
  const prevEnd = shift(`${month}-01`, -1);
  return [
    { key: "month", range: [`${month}-01`, today] },
    { key: "last-month", range: [`${prev}-01`, prevEnd] },
    { key: "7", range: [shift(today, -6), today] },
    { key: "30", range: [shift(today, -29), today] },
    { key: "90", range: [shift(today, -89), today] },
    { key: "ytd", range: [`${today.slice(0, 4)}-01-01`, today] },
  ];
}

// Regnskap: costs against revenue, key figures and the revenue report (docs/plan.md, section 16).
export default function AccountingPage() {
  const t = useTranslations("economy");
  const today = osloToday();
  const options = presets(today);
  const [preset, setPreset] = useState("month");
  const [from, to] = options.find((o) => o.key === preset)!.range;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [months, setMonths] = useState<Month[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    adminFetch<Summary>(`/accounting/summary?from=${from}&to=${to}`)
      .then((s) => !cancelled && setSummary(s))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [from, to, version]);

  useEffect(() => {
    let cancelled = false;
    adminFetch<Month[]>("/accounting/months?months=12")
      .then((m) => !cancelled && setMonths(m))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [version]);

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted">{t("accounting.intro")}</p>
      </div>
      <EconomyNav />
      <Field label={t("accounting.period")}>
        <select
          className={`${inputClass} sm:w-64`}
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {t(`accounting.preset.${o.key}`)}
            </option>
          ))}
        </select>
      </Field>
      <ErrorMessage message={error} />
      {summary && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              label="MRR"
              value={kr(summary.kpi.mrr)}
              note={t("accounting.mrrNote", {
                arr: kr(summary.kpi.arr),
                invoice: kr(summary.kpi.invoiceMrr),
              })}
            />
            <Tile
              label={t("accounting.activeSubscriptions")}
              value={String(summary.kpi.agreements)}
              note={t("accounting.subscriptionsNote", {
                paying: summary.kpi.payingCustomers,
                trials: summary.kpi.trials,
              })}
            />
            <Tile
              label={t("accounting.netRevenue")}
              value={kr(summary.revenue.net)}
              note={t("accounting.revenueNote", {
                gross: kr(summary.revenue.gross),
                vat: kr(summary.revenue.vat),
              })}
            />
            <Tile
              label={t("accounting.netResult")}
              value={kr(summary.result)}
              note={t("accounting.costsNote", {
                total: kr(summary.costs.total),
              })}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={t("accounting.costs")}>
              <Rows
                rows={[
                  [t("accounting.ai"), kr(summary.costs.ai)],
                  ["Soniox", kr(summary.costs.soniox)],
                  [t("accounting.eid"), kr(summary.costs.eid)],
                  [t("accounting.manualCosts"), kr(summary.costs.manual)],
                  [t("accounting.fixedCosts"), kr(summary.costs.fixed)],
                  [t("accounting.stripeFees"), t("accounting.notConnected")],
                ]}
                total={[t("shared.sum"), kr(summary.costs.total)]}
              />
            </Card>
            <Card title={t("accounting.revenue")}>
              <Rows
                rows={[
                  [
                    t("accounting.invoicePayments"),
                    kr(summary.revenue.invoices),
                  ],
                  [t("accounting.manualPayments"), kr(summary.revenue.manual)],
                  [t("accounting.grossRevenue"), kr(summary.revenue.gross)],
                  [t("accounting.collectedVat"), kr(summary.revenue.vat)],
                  ["Stripe", t("accounting.notConnected")],
                ]}
                total={[t("accounting.netRevenue"), kr(summary.revenue.net)]}
              />
              <p className="mt-3 text-sm text-muted">
                {formatDate(summary.from)}–{formatDate(summary.to)}
              </p>
            </Card>
          </div>
        </>
      )}
      {months && <MonthChart months={months} />}
      <RevenueReport today={today} />
      <Entries today={today} onChanged={() => setVersion((v) => v + 1)} />
    </section>
  );
}

function Tile({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-sm text-muted">{note}</p>
    </div>
  );
}

function Rows({
  rows,
  total,
}: {
  rows: [string, string][];
  total: [string, string];
}) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="text-right">{v}</dd>
        </div>
      ))}
      <dt className="border-t border-line pt-2 font-semibold">{total[0]}</dt>
      <dd className="border-t border-line pt-2 text-right font-semibold">
        {total[1]}
      </dd>
    </dl>
  );
}

// The last 12 months: revenue and costs as charts, the result in the table.
function MonthChart({ months }: { months: Month[] }) {
  const t = useTranslations("economy.accounting");
  return (
    <Card title={t("last12")}>
      <div className="flex flex-col gap-10">
        <ColumnChart
          title={t("revenueChart")}
          points={months.map((m) => ({
            label: monthName(m.month),
            value: Math.max(0, Math.round(m.revenue)),
          }))}
          unit={t("unit")}
        />
        <ColumnChart
          title={t("costsChart")}
          points={months.map((m) => ({
            label: monthName(m.month),
            value: Math.max(0, Math.round(m.costs)),
          }))}
          unit={t("unit")}
        />
        <div className="-mx-2 scroll-x">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="px-2 py-2 font-semibold">{t("month")}</th>
                <th className="px-2 py-2 text-right font-semibold">
                  {t("revenue")}
                </th>
                <th className="px-2 py-2 text-right font-semibold">
                  {t("costs")}
                </th>
                <th className="px-2 py-2 text-right font-semibold">
                  {t("result")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...months].reverse().map((m) => (
                <tr key={m.month}>
                  <td className="px-2 py-2 capitalize">{monthName(m.month)}</td>
                  <td className="px-2 py-2 text-right">{kr(m.revenue)}</td>
                  <td className="px-2 py-2 text-right">{kr(m.costs)}</td>
                  <td className="px-2 py-2 text-right font-semibold">
                    {kr(m.result)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

// Revenue per product, optionally per month, with CSV. No customer data.
function RevenueReport({ today }: { today: string }) {
  const t = useTranslations("economy.accounting");
  const ts = useTranslations("economy.shared");
  const [from, setFrom] = useState(() => {
    const prev = shift(`${today.slice(0, 7)}-01`, -1);
    return `${prev.slice(0, 7)}-01`;
  });
  const [to, setTo] = useState(() => shift(`${today.slice(0, 7)}-01`, -1));
  const [byMonth, setByMonth] = useState(false);
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const productName = (r: ReportRow) =>
    r.productKey ? t(`products.${r.productKey}`) : (r.product ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!from || !to) return;
    let cancelled = false;
    adminFetch<{ rows: ReportRow[] }>(
      `/accounting/revenue?from=${from}&to=${to}${byMonth ? "&byMonth=1" : ""}`,
    )
      .then((r) => {
        if (cancelled) return;
        setRows(r.rows);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [from, to, byMonth]);

  function exportCsv() {
    if (!rows) return;
    const csv = toCsv(
      [
        t("month"),
        t("product"),
        t("quantity"),
        t("net"),
        ts("vat"),
        t("totalWithVat"),
      ],
      rows.map((r) => [
        r.month ?? `${from}–${to}`,
        productName(r),
        r.quantity,
        r.net.toFixed(2),
        r.vat.toFixed(2),
        r.total.toFixed(2),
      ]),
    );
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = t("csvFile", { from, to });
    a.click();
    URL.revokeObjectURL(url);
  }

  const sum = (k: "net" | "vat" | "total") =>
    (rows ?? []).reduce((s, r) => s + r[k], 0);
  return (
    <Card title={t("report")}>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("from")}>
          <input
            type="date"
            className={inputClass}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label={t("to")}>
          <input
            type="date"
            className={inputClass}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={byMonth}
            onChange={(e) => setByMonth(e.target.checked)}
          />
          {t("byMonth")}
        </label>
        <button
          type="button"
          className={secondaryButton}
          disabled={!rows?.length}
          onClick={exportCsv}
        >
          {t("exportCsv")}
        </button>
      </div>
      <ErrorMessage message={error} />
      {rows && (
        <div className="-mx-2 mt-4 scroll-x">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="text-muted">
              <tr>
                {byMonth && (
                  <th className="px-2 py-2 font-semibold">{t("month")}</th>
                )}
                <th className="px-2 py-2 font-semibold">{t("product")}</th>
                <th className="px-2 py-2 text-right font-semibold">
                  {t("quantity")}
                </th>
                <th className="px-2 py-2 text-right font-semibold">
                  {t("net")}
                </th>
                <th className="px-2 py-2 text-right font-semibold">
                  {ts("vat")}
                </th>
                <th className="px-2 py-2 text-right font-semibold">
                  {ts("total")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, i) => (
                <tr key={i}>
                  {byMonth && (
                    <td className="px-2 py-2 capitalize">
                      {r.month ? monthName(r.month) : ""}
                    </td>
                  )}
                  <td className="px-2 py-2">{productName(r)}</td>
                  <td className="px-2 py-2 text-right">
                    {r.quantity.toLocaleString(formatTagNow())}
                  </td>
                  <td className="px-2 py-2 text-right">{kr(r.net)}</td>
                  <td className="px-2 py-2 text-right">{kr(r.vat)}</td>
                  <td className="px-2 py-2 text-right">{kr(r.total)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={byMonth ? 6 : 5}
                    className="px-2 py-3 text-muted"
                  >
                    {t("noPayments")}
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="font-semibold">
                <tr>
                  <td className="px-2 py-2" colSpan={byMonth ? 3 : 2}>
                    {ts("sum")}
                  </td>
                  <td className="px-2 py-2 text-right">{kr(sum("net"))}</td>
                  <td className="px-2 py-2 text-right">{kr(sum("vat"))}</td>
                  <td className="px-2 py-2 text-right">{kr(sum("total"))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </Card>
  );
}

// Manual costs and income (a negative amount is a credit or refund), and fixed monthly costs.
function Entries({
  today,
  onChanged,
}: {
  today: string;
  onChanged: () => void;
}) {
  const t = useTranslations("economy.accounting");
  const ts = useTranslations("economy.shared");
  const [data, setData] = useState<{
    entries: Entry[];
    fixed: FixedCost[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState({
    kind: "cost",
    description: "",
    amount: "",
    currency: "NOK",
    vatRate: "0.25",
    occurredOn: today,
  });
  const [fixed, setFixed] = useState({
    description: "",
    amount: "",
    currency: "NOK",
    startsMonth: today.slice(0, 7),
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      adminFetch<{ entries: Entry[]; fixed: FixedCost[] }>(
        "/accounting/entries",
      )
        .then(setData)
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    adminFetch<{ entries: Entry[]; fixed: FixedCost[] }>("/accounting/entries")
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t("manualTitle")}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await adminFetch("/accounting/entries", {
                method: "POST",
                body: {
                  ...entry,
                  vatRate: Number(entry.vatRate),
                  currency: entry.kind === "income" ? "NOK" : entry.currency,
                },
              });
              setEntry({ ...entry, description: "", amount: "" });
            });
          }}
          className="flex flex-col gap-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("type")}>
              <select
                className={inputClass}
                value={entry.kind}
                onChange={(e) => setEntry({ ...entry, kind: e.target.value })}
              >
                <option value="cost">{t("costOrAdjustment")}</option>
                <option value="income">{t("payment")}</option>
              </select>
            </Field>
            <Field label={t("date")}>
              <input
                required
                type="date"
                className={inputClass}
                value={entry.occurredOn}
                onChange={(e) =>
                  setEntry({ ...entry, occurredOn: e.target.value })
                }
              />
            </Field>
          </div>
          <Field label={ts("description")}>
            <input
              required
              maxLength={300}
              className={inputClass}
              value={entry.description}
              onChange={(e) =>
                setEntry({ ...entry, description: e.target.value })
              }
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={entry.kind === "income" ? t("amountWithVat") : t("amount")}
              hint={t("amountHint")}
            >
              <input
                required
                inputMode="decimal"
                className={inputClass}
                value={entry.amount}
                onChange={(e) => setEntry({ ...entry, amount: e.target.value })}
              />
            </Field>
            {entry.kind === "income" ? (
              <Field label={ts("vat")}>
                <select
                  className={inputClass}
                  value={entry.vatRate}
                  onChange={(e) =>
                    setEntry({ ...entry, vatRate: e.target.value })
                  }
                >
                  {[0.25, 0.15, 0.12, 0].map((r) => (
                    <option key={r} value={r}>
                      {percent(r)}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label={ts("currency")}>
                <select
                  className={inputClass}
                  value={entry.currency}
                  onChange={(e) =>
                    setEntry({ ...entry, currency: e.target.value })
                  }
                >
                  <option value="NOK">NOK</option>
                  <option value="USD">USD</option>
                </select>
              </Field>
            )}
          </div>
          <div>
            <button type="submit" disabled={busy} className={primaryButton}>
              {t("add")}
            </button>
          </div>
        </form>
        <ul className="mt-4 divide-y divide-line">
          {data?.entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                {e.description}
                <span className="block text-sm text-muted">
                  {formatDate(e.occurredOn)} ·{" "}
                  {e.kind === "income"
                    ? t("incomeLine", { vat: percent(e.vatRate) })
                    : t("costLine")}
                </span>
              </span>
              <span className="whitespace-nowrap">
                {e.currency === "USD" ? usd(e.amount) : kr(e.amount)}
              </span>
              <button
                type="button"
                className={secondaryButton}
                disabled={busy}
                onClick={() =>
                  window.confirm(t("confirmDeleteEntry")) &&
                  void run(() =>
                    adminFetch(`/accounting/entries/${e.id}`, {
                      method: "DELETE",
                    }),
                  )
                }
              >
                {ts("delete")}
              </button>
            </li>
          ))}
          {data && data.entries.length === 0 && (
            <li className="py-2 text-muted">{t("noEntries")}</li>
          )}
        </ul>
      </Card>
      <Card title={t("fixedCosts")}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await adminFetch("/accounting/fixed-costs", {
                method: "POST",
                body: fixed,
              });
              setFixed({ ...fixed, description: "", amount: "" });
            });
          }}
          className="flex flex-col gap-3"
        >
          <Field label={ts("description")}>
            <input
              required
              maxLength={300}
              className={inputClass}
              value={fixed.description}
              onChange={(e) =>
                setFixed({ ...fixed, description: e.target.value })
              }
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t("perMonth")}>
              <input
                required
                inputMode="decimal"
                className={inputClass}
                value={fixed.amount}
                onChange={(e) => setFixed({ ...fixed, amount: e.target.value })}
              />
            </Field>
            <Field label={ts("currency")}>
              <select
                className={inputClass}
                value={fixed.currency}
                onChange={(e) =>
                  setFixed({ ...fixed, currency: e.target.value })
                }
              >
                <option value="NOK">NOK</option>
                <option value="USD">USD</option>
              </select>
            </Field>
            <Field label={t("fromMonth")}>
              <input
                required
                type="month"
                className={inputClass}
                value={fixed.startsMonth}
                onChange={(e) =>
                  setFixed({ ...fixed, startsMonth: e.target.value })
                }
              />
            </Field>
          </div>
          <div>
            <button type="submit" disabled={busy} className={primaryButton}>
              {t("addFixed")}
            </button>
          </div>
        </form>
        <ul className="mt-4 divide-y divide-line">
          {data?.fixed.map((f) => (
            <FixedRow
              key={f.id}
              cost={f}
              busy={busy}
              onSave={(body) =>
                run(() =>
                  adminFetch(`/accounting/fixed-costs/${f.id}`, {
                    method: "PATCH",
                    body,
                  }),
                )
              }
              onDelete={() =>
                run(() =>
                  adminFetch(`/accounting/fixed-costs/${f.id}`, {
                    method: "DELETE",
                  }),
                )
              }
            />
          ))}
          {data && data.fixed.length === 0 && (
            <li className="py-2 text-muted">{t("noFixed")}</li>
          )}
        </ul>
        <ErrorMessage message={error} />
      </Card>
    </div>
  );
}

function FixedRow({
  cost,
  busy,
  onSave,
  onDelete,
}: {
  cost: FixedCost;
  busy: boolean;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const t = useTranslations("economy.accounting");
  const ts = useTranslations("economy.shared");
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(cost.description);
  const [amount, setAmount] = useState(cost.amount);
  const [endsMonth, setEndsMonth] = useState(cost.endsMonth?.slice(0, 7) ?? "");
  if (editing) {
    return (
      <li className="flex flex-col gap-2 py-3">
        <input
          className={inputClass}
          aria-label={ts("description")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            className={inputClass}
            aria-label={t("amountPerMonth")}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <input
            className={inputClass}
            aria-label={t("untilMonth")}
            type="month"
            value={endsMonth}
            onChange={(e) => setEndsMonth(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={primaryButton}
            disabled={busy}
            onClick={() =>
              void onSave({
                description,
                amount,
                endsMonth: endsMonth || null,
              }).then(() => setEditing(false))
            }
          >
            {ts("save")}
          </button>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => setEditing(false)}
          >
            {ts("cancel")}
          </button>
        </div>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
      <span className="min-w-0 flex-1">
        {cost.description}
        <span className="block text-sm text-muted">
          {t("fixedSince", { from: monthName(cost.startsMonth.slice(0, 7)) })}
          {cost.endsMonth
            ? t("fixedUntil", { to: monthName(cost.endsMonth.slice(0, 7)) })
            : ""}
        </span>
      </span>
      <span className="whitespace-nowrap">
        {t("fixedAmount", {
          amount: cost.currency === "USD" ? usd(cost.amount) : kr(cost.amount),
        })}
      </span>
      <button
        type="button"
        className={secondaryButton}
        onClick={() => setEditing(true)}
      >
        {ts("edit")}
      </button>
      <button
        type="button"
        className={secondaryButton}
        disabled={busy}
        onClick={() =>
          window.confirm(t("confirmDeleteFixed")) && void onDelete()
        }
      >
        {ts("delete")}
      </button>
    </li>
  );
}
