"use client";

import { useTranslations } from "next-intl";
import { inputClass, secondaryButton } from "@/components/admin/field";
import { type BillingPackage, percent, VAT_RATES } from "@/lib/billing";

export interface EditableLine {
  kind: "package" | "text" | "fee";
  packageId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: number;
}

export const emptyLine = (): EditableLine => ({
  kind: "text",
  packageId: null,
  description: "",
  quantity: "1",
  unitPrice: "",
  vatRate: 0.25,
});

export function packageLine(p: BillingPackage): EditableLine {
  return {
    kind: "package",
    packageId: p.id,
    description: p.name,
    quantity: "1",
    unitPrice: p.unitPrice,
    vatRate: p.vatRate,
  };
}

// Invoice lines as a small table of inputs. Prices exclude VAT. A package line takes the
// package's name, price and VAT, and can be adjusted.
export function LinesEditor({
  lines,
  onChange,
  packages = [],
  fee,
}: {
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  packages?: BillingPackage[];
  fee?: string | null;
}) {
  const t = useTranslations("economy.lines");
  const ts = useTranslations("economy.shared");
  const set = (i: number, patch: Partial<EditableLine>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pick = (i: number, value: string) => {
    if (value === "") return set(i, { kind: "text", packageId: null });
    const p = packages.find((x) => x.id === value);
    if (p) set(i, packageLine(p));
  };
  const active = packages.filter((p) => p.active);
  return (
    <div className="flex flex-col gap-3">
      {lines.map((l, i) => (
        <fieldset
          key={i}
          className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[10rem_1fr_6rem_8rem_6rem_auto] sm:items-end sm:border-0 sm:p-0"
        >
          <legend className="sr-only">{t("line", { number: i + 1 })}</legend>
          <label className="flex flex-col gap-1">
            <span className={`text-sm font-semibold ${i ? "sm:sr-only" : ""}`}>
              {t("type")}
            </span>
            {l.kind === "fee" ? (
              <span className="flex min-h-11 items-center">
                {t("invoiceFee")}
              </span>
            ) : (
              <select
                className={inputClass}
                value={l.packageId ?? ""}
                onChange={(e) => pick(i, e.target.value)}
              >
                <option value="">{t("freeText")}</option>
                {[
                  ...active,
                  ...packages.filter((p) => !p.active && p.id === l.packageId),
                ].map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </label>
          <label className="flex flex-col gap-1">
            <span className={`text-sm font-semibold ${i ? "sm:sr-only" : ""}`}>
              {ts("description")}
            </span>
            <input
              required
              maxLength={500}
              className={inputClass}
              value={l.description}
              onChange={(e) => set(i, { description: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={`text-sm font-semibold ${i ? "sm:sr-only" : ""}`}>
              {t("quantity")}
            </span>
            <input
              required
              inputMode="decimal"
              className={inputClass}
              value={l.quantity}
              onChange={(e) => set(i, { quantity: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={`text-sm font-semibold ${i ? "sm:sr-only" : ""}`}>
              {t("priceExVat")}
            </span>
            <input
              required
              inputMode="decimal"
              className={inputClass}
              value={l.unitPrice}
              onChange={(e) => set(i, { unitPrice: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={`text-sm font-semibold ${i ? "sm:sr-only" : ""}`}>
              {ts("vat")}
            </span>
            <select
              className={inputClass}
              value={l.vatRate}
              onChange={(e) => set(i, { vatRate: Number(e.target.value) })}
            >
              {VAT_RATES.map((r) => (
                <option key={r} value={r}>
                  {percent(r)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={secondaryButton}
            disabled={lines.length === 1}
            onClick={() => onChange(lines.filter((_, j) => j !== i))}
            aria-label={t("removeLine", { number: i + 1 })}
          >
            {t("remove")}
          </button>
        </fieldset>
      ))}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={secondaryButton}
          onClick={() => onChange([...lines, emptyLine()])}
          disabled={lines.length >= 50}
        >
          {t("addLine")}
        </button>
        {fee && !lines.some((l) => l.kind === "fee") && (
          <button
            type="button"
            className={secondaryButton}
            onClick={() =>
              onChange([
                ...lines,
                {
                  kind: "fee",
                  packageId: null,
                  description: t("invoiceFee"),
                  quantity: "1",
                  unitPrice: fee,
                  vatRate: 0.25,
                },
              ])
            }
          >
            {t("addFee")}
          </button>
        )}
      </div>
    </div>
  );
}
