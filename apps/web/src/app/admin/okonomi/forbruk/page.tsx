"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { EconomyNav } from "@/components/billing/economy-nav";
import { osloToday } from "@/components/billing/use-invoice-form";
import { adminFetch, formatDate } from "@/lib/admin";
import { kr } from "@/lib/billing";

interface Summary {
  from: string | null;
  to: string | null;
  ai: { calls: number; inputTokens: number; outputTokens: number; usd: number; unpriced: number };
  soniox: { transcriptions: number; asyncHours: number; realtimeHours: number; usd: number };
  eid: { provider: "bankid" | "vipps"; logins: number; registrations: number; failed: number; cancelled: number; nok: number | null }[];
  modules: { kind: string; name: string; count: number; inputTokens: number; outputTokens: number; usd: number; hours: number }[];
  models: { model: string; name: string; count: number; inputTokens: number; outputTokens: number; usd: number; unpriced: boolean }[];
  usd: number;
  rate: { day: string; usdNok: number } | null;
  nok: number | null;
  eidNok: number;
}

interface OrgRow {
  id: string;
  name: string;
  customerNumber: number;
  today: number;
  week: number;
  month: number;
  year: number;
  total: number;
  totalUsd: number;
  transcriptions: number;
}

interface Prices {
  models: { model: string; name: string; input: number; output: number }[];
  services: { key: string; amount: number | null; currency: "USD" | "NOK" }[];
  rates: { day: string; usdNok: number }[];
}

const num = new Intl.NumberFormat("nb-NO");
const usdFormat = new Intl.NumberFormat("nb-NO", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const usd = (v: number) => usdFormat.format(v);
const PROVIDER = { bankid: "BankID", vipps: "Vipps" } as const;
const SERVICE: Record<string, string> = {
  soniox_async_hour: "Soniox, per time lyd (etter samtalen)",
  soniox_realtime_hour: "Soniox, per time lyd (sanntid)",
  bankid_login: "BankID, per innlogging",
  vipps_login: "Vipps, per innlogging",
};

// The Monday and Sunday of an ISO week ("2026-W40").
function weekRange(week: string): [string, string] | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m) return null;
  const jan4 = new Date(Date.UTC(Number(m[1]), 0, 4));
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86_400_000 + (Number(m[2]) - 1) * 7 * 86_400_000);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return [monday.toISOString().slice(0, 10), sunday.toISOString().slice(0, 10)];
}

function monthRange(month: string): [string, string] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, "0")}`];
}

// Forbruk: what the call centres used of paid services, and what it cost (docs/plan.md, section 16).
export default function UsagePage() {
  const [dayPick, setDayPick] = useState("");
  const [weekPick, setWeekPick] = useState("");
  const [monthPick, setMonthPick] = useState(() => osloToday().slice(0, 7));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<OrgRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const range: [string, string] | null = dayPick ? [dayPick, dayPick] : weekPick ? weekRange(weekPick) : monthPick ? monthRange(monthPick) : null;
  const query = range ? `?from=${range[0]}&to=${range[1]}` : "";

  useEffect(() => {
    let cancelled = false;
    adminFetch<Summary>(`/usage/summary${query}`)
      .then((s) => {
        if (cancelled) return;
        setSummary(s);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    adminFetch<OrgRow[]>("/usage/organizations")
      .then((r) => !cancelled && setRows(r))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const nok = (value: number) => (summary?.rate ? kr(value * summary.rate.usdNok) : usd(value));
  const pick = (kind: "day" | "week" | "month", value: string) => {
    setDayPick(kind === "day" ? value : "");
    setWeekPick(kind === "week" ? value : "");
    setMonthPick(kind === "month" ? value : "");
  };

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Økonomi</h1>
        <p className="mt-2 text-muted">Hva callsentrene har brukt av betalte tjenester, og hva det koster oss.</p>
      </div>
      <EconomyNav />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Dag">
          <input type="date" className={inputClass} value={dayPick} max={osloToday()} onChange={(e) => pick("day", e.target.value)} />
        </Field>
        <Field label="Uke">
          <input type="week" className={inputClass} value={weekPick} onChange={(e) => pick("week", e.target.value)} />
        </Field>
        <Field label="Måned">
          <input type="month" className={inputClass} value={monthPick} max={osloToday().slice(0, 7)} onChange={(e) => pick("month", e.target.value)} />
        </Field>
        <button type="button" className={secondaryButton} onClick={() => pick("day", "")}>
          Nullstill
        </button>
        <p className="min-h-11 content-center text-sm text-muted">{range ? `${formatDate(range[0])}–${formatDate(range[1])}` : "Hele perioden"}</p>
      </div>
      <ErrorMessage message={error} />
      {summary && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              label="KI-generering"
              value={nok(summary.ai.usd)}
              note={`${num.format(summary.ai.calls)} kall, ${num.format(summary.ai.inputTokens)} tokens inn og ${num.format(summary.ai.outputTokens)} ut${summary.ai.unpriced ? `, ${summary.ai.unpriced} uten pris` : ""}`}
            />
            <Tile
              label="Soniox"
              value={nok(summary.soniox.usd)}
              note={`${num.format(summary.soniox.transcriptions)} transkripsjoner, ${num.format(summary.soniox.asyncHours)} t lyd, ${num.format(summary.soniox.realtimeHours)} t sanntid`}
            />
            <Tile
              label="BankID og Vipps"
              value={kr(summary.eidNok)}
              note={summary.eid.map((e) => `${PROVIDER[e.provider]} ${num.format(e.logins)}`).join(", ")}
            />
            <Tile
              label="Totalt"
              value={summary.nok === null ? usd(summary.usd) : kr(summary.nok)}
              note={summary.rate ? `${usd(summary.usd)} til kurs ${summary.rate.usdNok} (${formatDate(summary.rate.day)}), pluss eID` : "Ingen valutakurs ennå"}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Per modul">
              <Table
                head={["Modul", "Antall", "Tokens inn", "Tokens ut", "Kostnad"]}
                rows={summary.modules.map((m) => [
                  m.name,
                  num.format(m.count),
                  m.kind.startsWith("transcription") ? `${num.format(m.hours)} t` : num.format(m.inputTokens),
                  m.kind.startsWith("transcription") ? "" : num.format(m.outputTokens),
                  nok(m.usd),
                ])}
              />
            </Card>
            <Card title="Per modell">
              <Table
                head={["Modell", "Kall", "Tokens inn", "Tokens ut", "Kostnad"]}
                rows={summary.models.map((m) => [
                  m.name,
                  num.format(m.count),
                  num.format(m.inputTokens),
                  num.format(m.outputTokens),
                  m.unpriced ? "Mangler pris" : nok(m.usd),
                ])}
              />
            </Card>
          </div>

          <Card title="eID-pålogging">
            <Table
              head={["Metode", "Innlogginger", "Registreringer", "Mislykket", "Avbrutt", "Kostnad"]}
              rows={summary.eid.map((e) => [
                PROVIDER[e.provider],
                num.format(e.logins),
                num.format(e.registrations),
                num.format(e.failed),
                num.format(e.cancelled),
                e.nok === null ? "Mangler pris" : kr(e.nok),
              ])}
            />
          </Card>
        </>
      )}

      <OrganizationTable rows={rows} query={query} />
      <PriceTable />
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-sm text-muted">{note}</p>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  if (!rows.length) return <p className="text-muted">Ikke noe forbruk.</p>;
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={`px-2 py-2 font-semibold ${i ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line tabular-nums">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={`px-2 py-2 ${j ? "text-right" : ""}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type SortKey = "name" | "today" | "week" | "month" | "year" | "total" | "transcriptions";
const COLUMNS: [SortKey, string][] = [
  ["name", "Callsenter"],
  ["today", "I dag"],
  ["week", "Denne uken"],
  ["month", "Denne måneden"],
  ["year", "I år"],
  ["total", "Totalt"],
  ["transcriptions", "Transkripsjoner"],
];

// One row per call centre, sortable; a row opens the details for the chosen period.
function OrganizationTable({ rows, query }: { rows: OrgRow[] | null; query: string }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "total", desc: true });
  const [open, setOpen] = useState<string | null>(null);
  const sorted = useMemo(() => {
    const list = [...(rows ?? [])];
    list.sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      const cmp = typeof x === "string" ? x.localeCompare(y as string, "nb") : (x as number) - (y as number);
      return sort.desc ? -cmp : cmp;
    });
    return list;
  }, [rows, sort]);

  return (
    <Card title="Forbruk per callsenter">
      {!rows ? (
        <p className="text-muted">Laster …</p>
      ) : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="text-muted">
              <tr>
                {COLUMNS.map(([key, label], i) => (
                  <th key={key} className={`px-2 py-2 font-semibold ${i ? "text-right" : ""}`} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
                    <button
                      type="button"
                      className="min-h-11 font-semibold hover:text-brand"
                      onClick={() => setSort({ key, desc: sort.key === key ? !sort.desc : key !== "name" })}
                    >
                      {label}
                      {sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {sorted.map((r) => (
                <Fragment key={r.id}>
                  <tr>
                    <td className="px-2 py-2">
                      <button type="button" className="min-h-11 text-left font-semibold text-brand" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                        {r.name}
                      </button>
                    </td>
                    <td className="px-2 py-2 text-right">{kr(r.today)}</td>
                    <td className="px-2 py-2 text-right">{kr(r.week)}</td>
                    <td className="px-2 py-2 text-right">{kr(r.month)}</td>
                    <td className="px-2 py-2 text-right">{kr(r.year)}</td>
                    <td className="px-2 py-2 text-right">{kr(r.total)}</td>
                    <td className="px-2 py-2 text-right">{num.format(r.transcriptions)}</td>
                  </tr>
                  {open === r.id && (
                    <tr>
                      <td colSpan={7} className="bg-bg px-2 py-3">
                        <OrganizationDetail id={r.id} query={query} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-sm text-muted">Beløp i kroner til dagens kurs, med eID. Transkripsjoner er samtaler, uansett hvor mange ganger de er behandlet.</p>
    </Card>
  );
}

function OrganizationDetail({ id, query }: { id: string; query: string }) {
  const [detail, setDetail] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    adminFetch<Summary>(`/usage/organizations/${id}${query}`)
      .then((d) => !cancelled && setDetail(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id, query]);
  if (!detail) return error ? <ErrorMessage message={error} /> : <p className="text-muted">Laster …</p>;
  const nok = (value: number) => (detail.rate ? kr(value * detail.rate.usdNok) : usd(value));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div>
        <p className="font-semibold">Per modul</p>
        <ul>
          {detail.modules.map((m) => (
            <li key={m.kind}>
              {m.name}: {num.format(m.count)}, {nok(m.usd)}
            </li>
          ))}
          {!detail.modules.length && <li className="text-muted">Ikke noe forbruk i perioden.</li>}
        </ul>
      </div>
      <div>
        <p className="font-semibold">Per modell</p>
        <ul>
          {detail.models.map((m) => (
            <li key={m.model}>
              {m.name}: {num.format(m.inputTokens + m.outputTokens)} tokens, {m.unpriced ? "mangler pris" : nok(m.usd)}
            </li>
          ))}
          {!detail.models.length && <li className="text-muted">Ingen KI-kall.</li>}
        </ul>
      </div>
      <div>
        <p className="font-semibold">Soniox og eID</p>
        <ul>
          <li>
            {num.format(detail.soniox.transcriptions)} transkripsjoner, {num.format(detail.soniox.asyncHours)} t, {nok(detail.soniox.usd)}
          </li>
          {detail.eid.map((e) => (
            <li key={e.provider}>
              {PROVIDER[e.provider]}: {num.format(e.logins)} innlogginger{e.nok !== null && `, ${kr(e.nok)}`}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Prices per million tokens (USD), per hour of audio (USD) and per login (NOK), and the rate.
function PriceTable() {
  const [prices, setPrices] = useState<Prices | null>(null);
  const [draft, setDraft] = useState<Prices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      adminFetch<Prices>("/usage/prices")
        .then((p) => {
          setPrices(p);
          setDraft(p);
        })
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    adminFetch<Prices>("/usage/prices")
      .then((p) => {
        if (cancelled) return;
        setPrices(p);
        setDraft(p);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await adminFetch("/usage/prices", {
        method: "PATCH",
        body: {
          models: draft.models.map((m) => ({ model: m.model, name: m.name, input: String(m.input), output: String(m.output) })),
          services: Object.fromEntries(draft.services.map((s) => [s.key, s.amount === null ? null : String(s.amount)])),
        },
      });
      await load();
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function refresh() {
    setError(null);
    setBusy(true);
    try {
      await adminFetch("/usage/rate", { method: "POST" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Card title="Pristabell">
      {!draft || !prices ? (
        error ? <ErrorMessage message={error} /> : <p className="text-muted">Laster …</p>
      ) : (
        <form onSubmit={save} className="flex flex-col gap-6">
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="px-2 py-2 font-semibold">Modell</th>
                  <th className="px-2 py-2 font-semibold">USD per million tokens inn</th>
                  <th className="px-2 py-2 font-semibold">USD per million tokens ut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {draft.models.map((m, i) => (
                  <tr key={m.model}>
                    <td className="px-2 py-2">
                      {m.name}
                      <span className="block text-xs text-muted [overflow-wrap:anywhere]">{m.model}</span>
                    </td>
                    {(["input", "output"] as const).map((k) => (
                      <td key={k} className="px-2 py-2">
                        <input
                          inputMode="decimal"
                          aria-label={`${m.name}, ${k === "input" ? "inn" : "ut"}`}
                          className={`${inputClass} w-28`}
                          value={String(m[k])}
                          onChange={(e) => setDraft({ ...draft, models: draft.models.map((x, j) => (j === i ? { ...x, [k]: e.target.value as unknown as number } : x)) })}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {draft.services.map((s, i) => (
              <Field key={s.key} label={`${SERVICE[s.key] ?? s.key} (${s.currency})`} hint={s.amount === null ? "Ikke satt: regnes ikke med." : undefined}>
                <input
                  inputMode="decimal"
                  className={inputClass}
                  value={s.amount === null ? "" : String(s.amount)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      services: draft.services.map((x, j) => (j === i ? { ...x, amount: e.target.value === "" ? null : (e.target.value as unknown as number) } : x)),
                    })
                  }
                />
              </Field>
            ))}
          </div>
          <div>
            <p className="font-semibold">Valutakurs USD/NOK (Norges Bank)</p>
            <p className="text-sm text-muted">
              {prices.rates.length
                ? prices.rates.slice(0, 5).map((r) => `${formatDate(r.day)}: ${r.usdNok}`).join(" · ")
                : "Ingen kurs hentet ennå. Den hentes hver morgen."}
            </p>
          </div>
          <ErrorMessage message={error} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy} className={primaryButton}>
              Lagre priser
            </button>
            <button type="button" disabled={busy} className={secondaryButton} onClick={refresh}>
              Hent kurs nå
            </button>
            {saved && <span role="status">Lagret.</span>}
          </div>
        </form>
      )}
    </Card>
  );
}
