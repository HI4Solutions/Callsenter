"use client";

import { inputClass, secondaryButton } from "@/components/admin/field";
import { percent, VAT_RATES } from "@/lib/billing";

export interface EditableLine {
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: number;
}

export const emptyLine = (): EditableLine => ({ description: "", quantity: "1", unitPrice: "", vatRate: 0.25 });

// Invoice lines as a small table of inputs. Prices exclude VAT.
export function LinesEditor({ lines, onChange }: { lines: EditableLine[]; onChange: (lines: EditableLine[]) => void }) {
  const set = (i: number, patch: Partial<EditableLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="flex flex-col gap-3">
      {lines.map((l, i) => (
        <fieldset key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_6rem_8rem_6rem_auto] sm:items-end sm:border-0 sm:p-0">
          <legend className="sr-only">Linje {i + 1}</legend>
          <label className="flex flex-col gap-1">
            <span className={`text-sm font-semibold ${i ? "sm:sr-only" : ""}`}>Beskrivelse</span>
            <input required maxLength={500} className={inputClass} value={l.description} onChange={(e) => set(i, { description: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={`text-sm font-semibold ${i ? "sm:sr-only" : ""}`}>Antall</span>
            <input required inputMode="decimal" className={inputClass} value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={`text-sm font-semibold ${i ? "sm:sr-only" : ""}`}>Pris eks. mva</span>
            <input required inputMode="decimal" className={inputClass} value={l.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={`text-sm font-semibold ${i ? "sm:sr-only" : ""}`}>Mva</span>
            <select className={inputClass} value={l.vatRate} onChange={(e) => set(i, { vatRate: Number(e.target.value) })}>
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
            aria-label={`Fjern linje ${i + 1}`}
          >
            Fjern
          </button>
        </fieldset>
      ))}
      <div>
        <button type="button" className={secondaryButton} onClick={() => onChange([...lines, emptyLine()])} disabled={lines.length >= 50}>
          Legg til linje
        </button>
      </div>
    </div>
  );
}
