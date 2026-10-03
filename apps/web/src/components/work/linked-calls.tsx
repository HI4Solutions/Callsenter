"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage } from "@/components/admin/field";
import { CallList } from "@/components/work/call-list";
import { useWorkMe } from "@/components/work/work-shell";
import { type CallSummary, canSeeCalls } from "@/lib/calls";
import { orgFetch } from "@/lib/org";

// The calls linked to a customer or a sale, that the member may see.
export function LinkedCalls({ query }: { query: string }) {
  const me = useWorkMe();
  const t = useTranslations("work.linkedCalls");
  const tc = useTranslations("common");
  const visible = me ? canSeeCalls(me) : false;
  const [calls, setCalls] = useState<CallSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    orgFetch<CallSummary[]>(`/calls?${query}`)
      .then((rows) => !cancelled && setCalls(rows))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [query, visible]);

  if (!visible) return null;
  return (
    <Card title={t("title")}>
      <ErrorMessage message={error} />
      {!calls ? (
        !error && <p className="text-muted">{tc("loading")}</p>
      ) : calls.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <CallList calls={calls} showCustomer={false} />
      )}
    </Card>
  );
}
