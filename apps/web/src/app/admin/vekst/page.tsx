"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/admin/card";
import { ColumnChart, LineChart, type Marker } from "@/components/admin/charts";
import {
  ErrorMessage,
  Field,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/components/admin/field";
import {
  adminFetch,
  cumulative,
  formatDate,
  type Growth,
  monthLabel,
  useLocaleTag,
} from "@/lib/admin";

export default function GrowthPage() {
  const t = useTranslations("admin.growth");
  const tc = useTranslations("common");
  const [months, setMonths] = useState(12);
  const [data, setData] = useState<Growth | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (m: number) => adminFetch<Growth>(`/growth?months=${m}`),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    load(months)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [months, load]);

  const reload = async () => setData(await load(months));

  const charts = useMemo(() => {
    if (!data) return null;
    const labels = data.series.map((s) => monthLabel(s.month));
    const markers: Marker[] = data.events
      .map((e) => ({
        index: data.series.findIndex(
          (s) => s.month === e.occurredOn.slice(0, 7),
        ),
        title: e.title,
      }))
      .filter((m) => m.index >= 0);
    const totalUsers = cumulative(
      data.totals.usersBefore,
      data.series.map((s) => s.newUsers),
    );
    return {
      markers,
      users: labels.map((label, i) => ({ label, value: totalUsers[i]! })),
      organizations: labels.map((label, i) => ({
        label,
        value: data.series[i]!.newOrganizations,
      })),
      logins: labels.map((label, i) => ({
        label,
        value: data.series[i]!.logins,
      })),
    };
  }, [data]);

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            {t("title")}
          </h1>
          <p className="mt-2 text-muted">{t("intro")}</p>
        </div>
        <Field label={t("period")}>
          <select
            className={inputClass}
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
          >
            <option value={6}>{t("lastMonths", { count: 6 })}</option>
            <option value={12}>{t("lastMonths", { count: 12 })}</option>
            <option value={24}>{t("lastMonths", { count: 24 })}</option>
          </select>
        </Field>
      </div>
      <ErrorMessage message={error} />
      {!data && !error && <p className="text-muted">{tc("loading")}</p>}
      {data && charts && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label={t("activeOrganizations")}
              value={data.totals.openOrganizations}
              note={t("onTrial", { count: data.totals.trialOrganizations })}
            />
            <Stat
              label={t("closedOrganizations")}
              value={data.totals.closedOrganizations}
              note={t("closedNote")}
            />
            <Stat
              label={t("activeUsers")}
              value={data.totals.activeUsers}
              note={t("invited", { count: data.totals.invitedUsers })}
            />
            <Stat
              label={t("newUsers")}
              value={data.totals.newUsers30d}
              note={t("total", { count: data.totals.allUsers })}
            />
          </div>
          <Card title={t("development")}>
            <div className="flex flex-col gap-10">
              <LineChart
                title={t("usersTotal")}
                points={charts.users}
                unit={t("usersUnit")}
                markers={charts.markers}
              />
              <ColumnChart
                title={t("newOrganizations")}
                points={charts.organizations}
                unit={t("newOrganizationsUnit")}
                markers={charts.markers}
              />
              <ColumnChart
                title={t("loginsPerMonth")}
                points={charts.logins}
                unit={t("loginsUnit")}
                markers={charts.markers}
              />
            </div>
          </Card>
          <Events events={data.events} onChanged={reload} />
        </>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: number;
  note: string;
}) {
  const fmt = new Intl.NumberFormat(useLocaleTag());
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-3xl font-semibold">{fmt.format(value)}</p>
      <p className="text-sm text-muted">{note}</p>
    </div>
  );
}

function Events({
  events,
  onChanged,
}: {
  events: Growth["events"];
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("admin.growth");
  const tc = useTranslations("common");
  const [form, setForm] = useState({ title: "", occurredOn: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminFetch("/growth/events", { method: "POST", body: form });
      setForm({ title: "", occurredOn: "" });
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await adminFetch(`/growth/events/${id}`, { method: "DELETE" });
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card title={t("events")}>
      <p className="text-sm text-muted">{t("eventsIntro")}</p>
      <form
        onSubmit={submit}
        className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end"
      >
        <Field label={t("event")}>
          <input
            required
            maxLength={120}
            className={inputClass}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label={t("date")}>
          <input
            required
            type="date"
            className={inputClass}
            value={form.occurredOn}
            onChange={(e) => setForm({ ...form, occurredOn: e.target.value })}
          />
        </Field>
        <button type="submit" className={primaryButton} disabled={busy}>
          {t("add")}
        </button>
      </form>
      <div className="mt-3">
        <ErrorMessage message={error} />
      </div>
      {events.length > 0 && (
        <ul className="mt-4 divide-y divide-line">
          {events.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span>
                <span className="font-semibold">{e.title}</span> ·{" "}
                {formatDate(e.occurredOn)}
              </span>
              <button
                type="button"
                className={secondaryButton}
                onClick={() => remove(e.id)}
              >
                {tc("remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
