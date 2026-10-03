"use client";

import { useCallback, useEffect, useState } from "react";
import type { CallDetail, CallStatusCheck } from "@/lib/calls";
import { orgFetch } from "@/lib/org";

// One call, loaded once (a view, written to access_log) and loaded again when the worker has
// changed something. While the worker transcribes, checks the call or writes a note, only the
// status is checked every few seconds, which is not logged as a view.
export function useCall(id: string | null) {
  const [call, setCall] = useState<CallDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setCall(await orgFetch<CallDetail>(`/calls/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    orgFetch<CallDetail>(`/calls/${id}`)
      .then((c) => !cancelled && setCall(c))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const pendingNotes =
    call?.reports.filter((r) => r.status === "pending").length ?? 0;
  const waiting = call
    ? call.status === "processing" || call.working || pendingNotes > 0
    : false;
  useEffect(() => {
    if (!waiting || !call) return;
    const done = call.reports.filter((r) => r.status === "done").length;
    const seen = `${call.status}/${call.working}/${call.analyses.length}/${done}/${pendingNotes}`;
    const timer = setInterval(() => {
      orgFetch<CallStatusCheck>(`/calls/${call.id}?status=1`)
        .then((s) => {
          if (
            `${s.status}/${s.working}/${s.analyses}/${s.reports}/${s.pendingReports}` !==
            seen
          )
            void load();
        })
        .catch(() => undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, [waiting, call, pendingNotes, load]);

  return { call, error, setError, load, waiting };
}
