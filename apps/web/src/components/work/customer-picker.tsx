"use client";

import { useEffect, useState } from "react";
import { Field, inputClass, secondaryButton } from "@/components/admin/field";
import { orgFetch } from "@/lib/org";
import type { Customer } from "@/lib/work";

// Search and pick a customer in the current call centre.
export function CustomerPicker({
  value,
  onChange,
  hint,
}: {
  value: Pick<Customer, "id" | "name"> | null;
  onChange: (customer: Pick<Customer, "id" | "name"> | null) => void;
  hint?: string;
}) {
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<Customer[]>([]);

  useEffect(() => {
    if (value || !search.trim()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      orgFetch<Customer[]>(`/customers?q=${encodeURIComponent(search.trim())}`)
        .then((rows) => !cancelled && setMatches(rows.slice(0, 8)))
        .catch(() => !cancelled && setMatches([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, value]);

  if (value) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span>
          <span className="text-sm font-semibold">Kunde: </span>
          {value.name}
        </span>
        <button type="button" className={secondaryButton} onClick={() => onChange(null)}>
          Bytt kunde
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Field label="Kunde" hint={hint ?? "Søk på navn, telefon, e-post eller org.nr."}>
        <input type="search" className={`${inputClass} sm:max-w-md`} value={search} onChange={(e) => setSearch(e.target.value)} />
      </Field>
      {search.trim() && matches.length > 0 && (
        <ul className="flex flex-col gap-1 sm:max-w-md">
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center rounded-lg border border-line px-3 text-left hover:bg-bg"
                onClick={() => onChange(c)}
              >
                {c.name}
                {c.city && <span className="ml-2 text-sm text-muted">{c.city}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
