"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import {
  ErrorMessage,
  Field,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/components/admin/field";
import {
  type AccessRow,
  adminFetch,
  AUDIT_ACTION,
  AUDIT_TABLE,
  type AuditRow,
  type BlockedIp,
  changedFields,
  formatDate,
  formatDateTime,
  formatValue,
  LOGIN_RESULT,
  PROVIDER,
  type SecurityOverview,
  toCsv,
} from "@/lib/admin";

const SECTIONS = [
  { key: "oversikt", label: "overview" },
  { key: "revisjon", label: "audit" },
  { key: "tilgang", label: "access" },
  { key: "ip", label: "blocking" },
] as const;
type Section = (typeof SECTIONS)[number]["key"];

// A table's name in the audit log, or the table itself when it has none.
function useTableName() {
  const td = useTranslations("domain");
  return (table: string) =>
    table in AUDIT_TABLE ? td(`auditTable.${table as "users"}`) : table;
}

export default function SecurityPage() {
  const t = useTranslations("admin.security");
  const [section, setSection] = useState<Section>("oversikt");
  // Set from the overview to prefill the block form.
  const [blockPrefill, setBlockPrefill] = useState("");

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted">{t("intro")}</p>
      </div>
      <div
        role="tablist"
        aria-label={t("title")}
        className="flex flex-wrap gap-2"
      >
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={section === s.key}
            className={`min-h-11 rounded-lg px-4 font-semibold ${
              section === s.key
                ? "bg-brand text-on-brand"
                : "border border-line bg-surface"
            }`}
            onClick={() => setSection(s.key)}
          >
            {t(`sections.${s.label}`)}
          </button>
        ))}
      </div>
      {section === "oversikt" && (
        <Overview
          onBlock={(ip) => {
            setBlockPrefill(ip);
            setSection("ip");
          }}
        />
      )}
      {section === "revisjon" && <AuditLog />}
      {section === "tilgang" && <AccessLog />}
      {section === "ip" && <BlockedIps prefill={blockPrefill} />}
    </section>
  );
}

function Overview({ onBlock }: { onBlock: (ip: string) => void }) {
  const t = useTranslations("admin.security");
  const td = useTranslations("domain");
  const tc = useTranslations("common");
  const [hours, setHours] = useState(24);
  const [data, setData] = useState<SecurityOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminFetch<SecurityOverview>(`/security/overview?hours=${hours}`)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [hours]);

  return (
    <div className="flex flex-col gap-6">
      <Field label={t("period")}>
        <select
          className={`${inputClass} sm:max-w-xs`}
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
        >
          <option value={24}>{t("lastDay")}</option>
          <option value={24 * 7}>{t("lastDays", { count: 7 })}</option>
          <option value={24 * 30}>{t("lastDays", { count: 30 })}</option>
        </select>
      </Field>
      <ErrorMessage message={error} />
      {!data && !error && <p className="text-muted">{tc("loading")}</p>}
      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface p-4">
              <p className="text-sm text-muted">{t("successful")}</p>
              <p className="text-3xl font-extrabold">{data.totals.success}</p>
            </div>
            <div className="rounded-xl border border-line bg-surface p-4">
              <p className="text-sm text-muted">{t("failed")}</p>
              <p className="text-3xl font-extrabold">{data.totals.failed}</p>
            </div>
          </div>

          <Card title={t("failedByIp")}>
            {data.failedByIp.length === 0 ? (
              <p className="text-muted">{t("noneInPeriod")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.failedByIp.map((r) => (
                  <li
                    key={r.ip}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-mono font-semibold">{r.ip}</p>
                      <p className="text-sm text-muted">
                        {t("ipFailures", {
                          failures: r.failures,
                          users: r.users,
                          date: formatDateTime(r.lastAt),
                        })}
                        {r.failures >= 5 && ` · ${t("suspicious")}`}
                      </p>
                    </div>
                    {r.blocked ? (
                      <span className="text-sm font-semibold">
                        {t("blocked")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={secondaryButton}
                        onClick={() => onBlock(r.ip)}
                      >
                        {t("block")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t("failedByUser")}>
            {data.failedByUser.length === 0 ? (
              <p className="text-muted">{t("noneInPeriod")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.failedByUser.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap justify-between gap-2 py-3"
                  >
                    <Link
                      href={`/admin/brukere/${r.id}`}
                      className="font-semibold text-brand"
                    >
                      {r.name}
                    </Link>
                    <span className="text-sm">
                      {t("userFailures", {
                        failures: r.failures,
                        date: formatDateTime(r.lastAt),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t("recent")}>
            {data.recent.length === 0 ? (
              <p className="text-muted">{t("noneInPeriod")}</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {data.recent.map((r, index) => (
                  <li
                    key={index}
                    className="flex flex-col gap-1 py-2 sm:flex-row sm:justify-between"
                  >
                    <span>
                      {formatDateTime(r.occurredAt)} · {PROVIDER[r.provider]} ·{" "}
                      <span className="font-semibold">
                        {r.result in LOGIN_RESULT
                          ? td(`loginResult.${r.result as "success"}`)
                          : r.result}
                      </span>
                      {r.userName && ` · ${r.userName}`}
                    </span>
                    <span className="font-mono text-muted">
                      {r.ip ?? t("unknownIp")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function AuditLog() {
  const t = useTranslations("admin.security");
  const td = useTranslations("domain");
  const tc = useTranslations("common");
  const tableName = useTableName();
  // German capitalises nouns; the other languages write the table in lower case after the action.
  const lower = useLocale() !== "de";
  const [filters, setFilters] = useState({
    table: "",
    action: "",
    from: "",
    to: "",
  });
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(
    async (before: string | null) => {
      const params = new URLSearchParams(
        Object.entries(filters).filter(([, v]) => v),
      );
      if (before) params.set("before", before);
      const page = await adminFetch<{ rows: AuditRow[]; next: string | null }>(
        `/security/audit?${params}`,
      );
      return page;
    },
    [filters],
  );

  useEffect(() => {
    let cancelled = false;
    load(null)
      .then((page) => {
        if (cancelled) return;
        setRows(page.rows);
        setNext(page.next);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function more() {
    if (!next) return;
    try {
      const page = await load(next);
      setRows((current) => [...(current ?? []), ...page.rows]);
      setNext(page.next);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function exportCsv() {
    if (!rows) return;
    const csv = toCsv(
      [
        t("csv.time"),
        t("csv.action"),
        t("csv.type"),
        t("csv.organization"),
        t("csv.actor"),
        t("csv.asSuperadmin"),
        t("csv.changes"),
      ],
      rows.map((r) => [
        formatDateTime(r.occurredAt),
        td(`auditAction.${r.action}`),
        tableName(r.table),
        r.organizationName,
        r.actorName ?? t("system"),
        r.asPlatformAdmin ? t("yes") : t("no"),
        changedFields(r.oldData, r.newData)
          .map(
            (c) =>
              `${c.field}: ${formatValue(c.before)} → ${formatValue(c.after)}`,
          )
          .join(" | "),
      ]),
    );
    download(
      csv,
      `${t("csvFile")}-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }

  const set =
    (key: keyof typeof filters) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setFilters({ ...filters, [key]: e.target.value });

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label={t("type")}>
          <select
            className={inputClass}
            value={filters.table}
            onChange={set("table")}
          >
            <option value="">{t("all")}</option>
            {Object.keys(AUDIT_TABLE).map((key) => (
              <option key={key} value={key}>
                {tableName(key)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("action")}>
          <select
            className={inputClass}
            value={filters.action}
            onChange={set("action")}
          >
            <option value="">{t("all")}</option>
            {(Object.keys(AUDIT_ACTION) as AuditRow["action"][]).map((key) => (
              <option key={key} value={key}>
                {td(`auditAction.${key}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("from")}>
          <input
            type="date"
            className={inputClass}
            value={filters.from}
            onChange={set("from")}
          />
        </Field>
        <Field label={t("to")}>
          <input
            type="date"
            className={inputClass}
            value={filters.to}
            onChange={set("to")}
          />
        </Field>
      </div>
      <div>
        <button
          type="button"
          className={secondaryButton}
          onClick={exportCsv}
          disabled={!rows?.length}
        >
          {t("exportCsv")}
        </button>
      </div>
      <ErrorMessage message={error} />
      {!rows && !error && <p className="text-muted">{tc("loading")}</p>}
      {rows && rows.length === 0 && (
        <p className="text-muted">{t("noneMatch")}</p>
      )}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {rows.map((r) => {
            const changes = changedFields(r.oldData, r.newData);
            const expanded = open === r.id;
            return (
              <li key={r.id} className="p-4">
                <button
                  type="button"
                  className="flex w-full flex-col gap-1 text-left sm:flex-row sm:items-center sm:justify-between"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : r.id)}
                >
                  <span>
                    <span className="font-semibold">
                      {td(`auditAction.${r.action}`)}{" "}
                      {lower
                        ? tableName(r.table).toLowerCase()
                        : tableName(r.table)}
                    </span>
                    {r.organizationName && (
                      <span className="text-muted">
                        {" "}
                        · {r.organizationName}
                      </span>
                    )}
                  </span>
                  <span className="text-sm text-muted">
                    {formatDateTime(r.occurredAt)} ·{" "}
                    {r.actorName ?? t("system")}
                    {r.asPlatformAdmin && ` ${t("asSuperadmin")}`}
                  </span>
                </button>
                {expanded && (
                  <dl className="mt-3 grid gap-x-4 gap-y-1 rounded-lg bg-bg p-3 text-sm sm:grid-cols-[auto_1fr]">
                    {changes.length === 0 && <dd>{t("noChanges")}</dd>}
                    {changes.map((c) => (
                      <div key={c.field} className="contents">
                        <dt className="font-mono font-semibold">{c.field}</dt>
                        <dd className="break-all">
                          {r.action === "update"
                            ? `${formatValue(c.before)} → ${formatValue(c.after)}`
                            : formatValue(c.after ?? c.before)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {next && (
        <div>
          <button type="button" className={secondaryButton} onClick={more}>
            {t("showMore")}
          </button>
        </div>
      )}
    </div>
  );
}

function AccessLog() {
  const t = useTranslations("admin.security");
  const tc = useTranslations("common");
  const [rows, setRows] = useState<AccessRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminFetch<{ rows: AccessRow[]; next: string | null }>("/security/access")
      .then((page) => {
        if (cancelled) return;
        setRows(page.rows);
        setNext(page.next);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  async function more() {
    if (!next) return;
    try {
      const page = await adminFetch<{ rows: AccessRow[]; next: string | null }>(
        `/security/access?before=${next}`,
      );
      setRows((current) => [...(current ?? []), ...page.rows]);
      setNext(page.next);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const ACTIONS = ["view", "play", "download"];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted">{t("accessIntro")}</p>
      <ErrorMessage message={error} />
      {!rows && !error && <p className="text-muted">{tc("loading")}</p>}
      {rows && rows.length === 0 && (
        <p className="text-muted">{t("noEvents")}</p>
      )}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface text-sm">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-1 p-3 sm:flex-row sm:justify-between"
            >
              <span>
                <span className="font-semibold">
                  {ACTIONS.includes(r.action)
                    ? t(`accessAction.${r.action as "view"}`)
                    : r.action}
                </span>{" "}
                · {r.resourceType} {r.resourceId} · {r.organizationName}
              </span>
              <span className="text-muted">
                {formatDateTime(r.occurredAt)} · {r.userName}
              </span>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <div>
          <button type="button" className={secondaryButton} onClick={more}>
            {t("showMore")}
          </button>
        </div>
      )}
    </div>
  );
}

function BlockedIps({ prefill }: { prefill: string }) {
  const t = useTranslations("admin.security");
  const tc = useTranslations("common");
  const [list, setList] = useState<BlockedIp[] | null>(null);
  const [form, setForm] = useState({
    network: prefill,
    reason: "",
    expiresAt: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(
    () =>
      adminFetch<BlockedIp[]>("/security/blocked-ips")
        .then(setList)
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    adminFetch<BlockedIp[]>("/security/blocked-ips")
      .then((rows) => !cancelled && setList(rows))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminFetch("/security/blocked-ips", {
        method: "POST",
        body: { ...form, expiresAt: form.expiresAt || null },
      });
      setForm({ network: "", reason: "", expiresAt: "" });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: BlockedIp) {
    if (!window.confirm(t("confirmUnblock", { network: item.network }))) return;
    try {
      await adminFetch(`/security/blocked-ips/${item.id}`, {
        method: "DELETE",
      });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const set =
    (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [key]: e.target.value });

  return (
    <div className="flex flex-col gap-6">
      <Card title={t("blockIp")}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("network")} hint={t("networkHint")}>
              <input
                required
                className={`${inputClass} font-mono`}
                value={form.network}
                onChange={set("network")}
              />
            </Field>
            <Field label={t("reason")}>
              <input
                className={inputClass}
                value={form.reason}
                onChange={set("reason")}
              />
            </Field>
            <Field label={t("expires")} hint={t("expiresHint")}>
              <input
                type="date"
                className={inputClass}
                value={form.expiresAt}
                onChange={set("expiresAt")}
              />
            </Field>
          </div>
          <p className="text-sm text-muted">{t("blockNote")}</p>
          <ErrorMessage message={error} />
          <div>
            <button type="submit" className={primaryButton} disabled={busy}>
              {busy ? t("blocking") : t("block")}
            </button>
          </div>
        </form>
      </Card>
      <Card title={t("blockedList")}>
        {!list && <p className="text-muted">{tc("loading")}</p>}
        {list && list.length === 0 && (
          <p className="text-muted">{t("noneBlocked")}</p>
        )}
        {list && list.length > 0 && (
          <ul className="divide-y divide-line">
            {list.map((b) => (
              <li
                key={b.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-mono font-semibold">{b.network}</p>
                  <p className="text-sm text-muted">
                    {b.reason ?? t("noReason")} ·{" "}
                    {b.createdByName ?? t("unknown")} {formatDate(b.createdAt)}
                    {b.expiresAt
                      ? ` · ${t("expiresOn", { date: formatDate(b.expiresAt) })}`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() => remove(b)}
                >
                  {t("unblock")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function download(content: string, filename: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
