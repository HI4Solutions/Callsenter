"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  ErrorMessage,
  Field,
  inputClass,
  primaryButton,
} from "@/components/admin/field";
import type { CallLookup } from "@/lib/complaints";
import { formatDateTime } from "@/lib/format";
import { orgFetch } from "@/lib/org";

// Finds a call by the reference the seller pasted into the call centre's own sales system
// (VQ-XXXX-XXXX, written any way). Only calls the case handler may see are found, and each lookup
// is logged like a search.
export function ReferenceLookup({
  label,
  hint,
  submit,
  onFound,
}: {
  label: string;
  hint?: string;
  submit: string;
  onFound: (found: CallLookup) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function find(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onFound(
        await orgFetch<CallLookup>(
          `/complaints/lookup?reference=${encodeURIComponent(value.trim())}`,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={find} className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label={label} hint={hint}>
          <input
            className={`${inputClass} font-mono uppercase sm:w-64`}
            value={value}
            placeholder="VQ-XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className={`${primaryButton} sm:mb-0.5`}
        >
          {submit}
        </button>
      </div>
      <ErrorMessage message={error} />
    </form>
  );
}

// What the lookup found: when the call was made, by whom, about what.
export function FoundCall({ call }: { call: CallLookup["call"] }) {
  const t = useTranslations("complaints.lookup");
  return (
    <p className="text-muted">
      {[
        formatDateTime(call.startedAt),
        call.userName,
        call.productName,
        call.customerName && t("customer", { name: call.customerName }),
      ]
        .filter(Boolean)
        .join(" · ")}
    </p>
  );
}
