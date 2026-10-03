"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Field, inputClass } from "@/components/admin/field";
import { addDays, osloToday, PERIOD_KEYS, type PeriodKey, periodRange } from "@/lib/dashboard";

export interface Period {
  key: PeriodKey;
  from: string;
  to: string;
}

const STORAGE = "veriqall.periode";

// The period last chosen on this device (I dag, I går, denne uken …), or today.
export function useStoredPeriod(fallback: Exclude<PeriodKey, "custom"> = "today") {
  const [period, setPeriod] = useState<Period>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) ?? "null") as Period | null;
      if (saved?.key === "custom" && /^\d{4}-\d{2}-\d{2}$/.test(saved.from) && /^\d{4}-\d{2}-\d{2}$/.test(saved.to)) return saved;
      if (saved && PERIOD_KEYS.includes(saved.key) && saved.key !== "custom") return { key: saved.key, ...periodRange(saved.key) };
    } catch {
      // Private window or no storage: start with the fallback.
    }
    return { key: fallback, ...periodRange(fallback) };
  });
  const change = (next: Period) => {
    setPeriod(next);
    try {
      localStorage.setItem(STORAGE, JSON.stringify(next));
    } catch {
      // Not remembered; the choice still applies on this page.
    }
  };
  return [period, change] as const;
}

// The period of the overview: the usual choices, or two dates (at most a year).
export function PeriodPicker({ value, onChange }: { value: Period; onChange: (period: Period) => void }) {
  const t = useTranslations("dashboard.period");
  const td = useTranslations("domain.period");
  const today = osloToday();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label={t("label")}>
        <select
          className={inputClass}
          value={value.key}
          onChange={(e) => {
            const key = e.target.value as PeriodKey;
            onChange(key === "custom" ? { key, from: value.from, to: value.to } : { key, ...periodRange(key) });
          }}
        >
          {PERIOD_KEYS.map((key) => (
            <option key={key} value={key}>
              {td(key)}
            </option>
          ))}
        </select>
      </Field>
      {value.key === "custom" && (
        <>
          <Field label={t("from")}>
            <input
              type="date"
              className={inputClass}
              value={value.from}
              min={addDays(value.to, -365)}
              max={value.to}
              onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
            />
          </Field>
          <Field label={t("to")}>
            <input
              type="date"
              className={inputClass}
              value={value.to}
              min={value.from}
              max={today}
              onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
            />
          </Field>
        </>
      )}
    </div>
  );
}
