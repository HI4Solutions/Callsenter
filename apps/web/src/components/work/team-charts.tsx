"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatNumber, formatPercent, shortDay, type TeamSeller, sum } from "@/lib/dashboard";
import { formatTagNow } from "@/lib/format";

// Charts of the sellers in a team, for leaders. One hue (the brand colour) for amounts; green,
// yellow and red stay reserved for the AI flags. Every figure is also written as text, so nothing
// rests on colour alone.

function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${
            value === o.key ? "border-brand bg-brand text-on-brand" : "border-line bg-surface hover:bg-bg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// --- Sellers side by side ----------------------------------------------------------------------

type BarMetric = "sales" | "calls" | "redShare" | "unreviewed";

const BAR_METRICS: BarMetric[] = ["sales", "calls", "redShare", "unreviewed"];

type TeamText = ReturnType<typeof useTranslations<"dashboard.team">>;

function barValue(s: TeamSeller, metric: BarMetric, t: TeamText): { value: number; text: string } {
  const calls = sum(s.calls);
  switch (metric) {
    case "sales":
      return { value: sum(s.sales), text: formatNumber(sum(s.sales)) };
    case "calls":
      return { value: calls, text: formatNumber(calls) };
    case "unreviewed":
      return { value: s.unreviewed, text: formatNumber(s.unreviewed) };
    case "redShare": {
      const red = sum(s.red);
      const share = calls ? Math.round((red / calls) * 100) : 0;
      const text = t("redShareValue", { share: formatPercent(share), red: formatNumber(red), calls: formatNumber(calls) });
      return { value: share, text: calls ? text : "–" };
    }
  }
}

// One bar per seller, longest first, with the figure written at the end of each bar.
export function SellerBars({ sellers }: { sellers: TeamSeller[] }) {
  const t = useTranslations("dashboard.team");
  const [metric, setMetric] = useState<BarMetric>("sales");
  const rows = sellers
    .map((s) => ({ seller: s, ...barValue(s, metric, t) }))
    .sort((a, b) => b.value - a.value || a.seller.name.localeCompare(b.seller.name, formatTagNow()));
  const options = BAR_METRICS.map((key) => ({ key, label: t(`metrics.${key}`) }));
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-4">
      <Choice label={t("compareBy")} value={metric} options={options} onChange={setMetric} />
      {metric === "redShare" && <p className="text-sm text-muted">{t("redShareHint")}</p>}
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li
            key={r.seller.userId}
            className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]"
          >
            <Link href={`/oversikt/selgere/${r.seller.userId}`} className="truncate text-sm font-semibold text-brand" title={r.seller.name}>
              {r.seller.name}
            </Link>
            {/* The bar has its own track, so a long figure never pushes the row wider than the card. */}
            <span className="min-w-0" aria-hidden="true">
              <span
                className="block h-3.5 rounded-r bg-brand"
                style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value > 0 ? "3px" : "0" }}
              />
            </span>
            <span className="text-right text-sm whitespace-nowrap">{r.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Activity day by day -------------------------------------------------------------------------

type HeatMetric = "calls" | "sales" | "red";

const HEAT_METRICS: HeatMetric[] = ["calls", "sales", "red"];

// Five steps of the brand colour, light to dark (dark to light in dark mode, where the brand is
// light): more is always further from the surface.
const STEPS = [18, 34, 52, 72, 92];

function columnsFor(days: string[]): { label: string; title: string; from: number; to: number }[] {
  const label = shortDay;
  if (days.length <= 31) {
    const day = new Intl.DateTimeFormat(formatTagNow(), { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" });
    return days.map((d, i) => ({ label: label(d), title: day.format(new Date(`${d}T00:00:00Z`)), from: i, to: i }));
  }
  const out = [];
  for (let i = 0; i < days.length; i += 7) {
    const last = Math.min(i + 6, days.length - 1);
    out.push({ label: label(days[i]!), title: `${label(days[i]!)}–${label(days[last]!)}`, from: i, to: last });
  }
  return out;
}

// Rows are sellers, columns are days (weeks over a month), and each cell shows the figure.
export function ActivityHeatmap({ days, sellers }: { days: string[]; sellers: TeamSeller[] }) {
  const t = useTranslations("dashboard.team");
  const [metric, setMetric] = useState<HeatMetric>("calls");
  const options = HEAT_METRICS.map((key) => ({ key, label: t(`metrics.${key}`) }));
  const columns = columnsFor(days);
  const value = (s: TeamSeller, c: { from: number; to: number }) => sum(s[metric].slice(c.from, c.to + 1));
  const max = Math.max(0, ...sellers.flatMap((s) => columns.map((c) => value(s, c))));
  const step = (v: number) =>
    v <= 0 || max === 0 ? -1 : Math.min(STEPS.length - 1, Math.floor(((v - 1) / Math.max(1, max)) * STEPS.length));
  return (
    <div className="flex flex-col gap-4">
      <Choice label={t("show")} value={metric} options={options} onChange={setMetric} />
      <div className="-mx-2 overflow-x-auto px-2">
        <table className="w-full border-separate border-spacing-0.5 text-xs">
          <caption className="sr-only">
            {t("heatmapCaption", { metric: t(`metrics.${metric}`), unit: columns.length === days.length ? "day" : "week" })}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 w-36 bg-surface pr-2 text-left font-semibold text-muted">
                {t("seller")}
              </th>
              {columns.map((c) => (
                <th key={c.label} scope="col" className="min-w-8 px-0.5 text-center font-normal text-muted" title={c.title}>
                  {c.label}
                </th>
              ))}
              <th scope="col" className="w-12 pl-2 text-right font-semibold text-muted">
                {t("sum")}
              </th>
            </tr>
          </thead>
          <tbody>
            {sellers.map((s) => (
              <tr key={s.userId}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 max-w-36 truncate bg-surface pr-2 text-left text-sm font-semibold"
                  title={s.name}
                >
                  {s.name}
                </th>
                {columns.map((c) => {
                  const v = value(s, c);
                  const k = step(v);
                  return (
                    <td
                      key={c.label}
                      title={t("cell", { name: s.name, title: c.title, value: t(`units.${metric}`, { count: v }) })}
                      className={`h-8 min-w-8 rounded text-center ${k >= 3 ? "text-on-brand" : ""} ${k < 0 ? "text-muted" : ""}`}
                      style={{
                        background: k < 0 ? "transparent" : `color-mix(in srgb, var(--brand) ${STEPS[k]}%, var(--surface))`,
                        boxShadow: k < 0 ? "inset 0 0 0 1px var(--border)" : undefined,
                      }}
                    >
                      {v > 0 ? formatNumber(v) : ""}
                    </td>
                  );
                })}
                <td className="pl-2 text-right text-sm font-semibold">{formatNumber(sum(s[metric]))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-sm text-muted" aria-hidden="true">
        <span>{t("fewer")}</span>
        {STEPS.map((p) => (
          <span key={p} className="size-4 rounded" style={{ background: `color-mix(in srgb, var(--brand) ${p}%, var(--surface))` }} />
        ))}
        <span>{t("more")}</span>
      </div>
    </div>
  );
}

// --- Who needs follow-up ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

// A reason: its key in dashboard.team.reasons, and the figures for its text.
export interface FollowUpReason {
  key: "unreviewed" | "breaches" | "noFeedbackYet" | "noFeedback30" | "inactive";
  values?: { count?: number; share?: number; red?: number; calls?: number };
}

// Reasons to look at a seller now, most pressing first: flags waiting for review, a high share of
// breaches, no feedback for a long time, or no calls at all.
export function followUp(sellers: TeamSeller[], now = Date.now()): { seller: TeamSeller; reasons: FollowUpReason[]; weight: number }[] {
  return sellers
    .map((s) => {
      const calls = sum(s.calls);
      const red = sum(s.red);
      const reasons: FollowUpReason[] = [];
      let weight = 0;
      if (s.unreviewed > 0) {
        reasons.push({ key: "unreviewed", values: { count: s.unreviewed } });
        weight += 3 + s.unreviewed;
      }
      if (red >= 2 && red / calls >= 0.2) {
        reasons.push({ key: "breaches", values: { share: Math.round((red / calls) * 100), red, calls } });
        weight += 2 + (red / calls) * 10;
      }
      if (calls > 0) {
        if (!s.lastFeedbackAt) {
          reasons.push({ key: "noFeedbackYet" });
          weight += 1;
        } else if (now - Date.parse(s.lastFeedbackAt) > 30 * DAY_MS) {
          reasons.push({ key: "noFeedback30" });
          weight += 1;
        }
      } else if (sum(s.sales) === 0) {
        reasons.push({ key: "inactive" });
        weight += 0.5;
      }
      return { seller: s, reasons, weight };
    })
    .filter((r) => r.reasons.length)
    .sort((a, b) => b.weight - a.weight || a.seller.name.localeCompare(b.seller.name, formatTagNow()));
}

export function FollowUp({ sellers }: { sellers: TeamSeller[] }) {
  const t = useTranslations("dashboard.team");
  const text = ({ key, values: v = {} }: FollowUpReason) =>
    key === "unreviewed"
      ? t("reasons.unreviewed", { count: v.count ?? 0 })
      : key === "breaches"
        ? t("reasons.breaches", { share: formatPercent(v.share ?? 0), red: formatNumber(v.red ?? 0), calls: formatNumber(v.calls ?? 0) })
        : t(`reasons.${key}`);
  const list = followUp(sellers).slice(0, 8);
  if (!list.length) return <p className="text-muted">{t("nobodyNeedsFollowUp")}</p>;
  return (
    <ul className="divide-y divide-line">
      {list.map(({ seller, reasons }) => (
        <li key={seller.userId} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <Link
            href={`/oversikt/selgere/${seller.userId}`}
            className="inline-flex min-h-11 items-center font-semibold text-brand sm:min-h-0"
          >
            {seller.name}
          </Link>
          <ul className="text-sm text-muted sm:text-right">
            {reasons.map((r) => (
              <li key={r.key}>{text(r)}</li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
