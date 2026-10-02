"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { CallList } from "@/components/work/call-list";
import { NoAccess, useWorkMe } from "@/components/work/work-shell";
import { CALL_STATUS, type CallStatus, type CallSummary, canSeeCalls } from "@/lib/calls";
import { orgFetch } from "@/lib/org";

export default function CallsPage() {
  const me = useWorkMe();
  const permissions = me?.permissions ?? [];
  const visible = me ? canSeeCalls(me) : false;
  const canRecord = permissions.includes("calls.upload");
  const canReview = permissions.includes("flags.review");
  const [query, setQuery] = useState("");
  const [flag, setFlag] = useState("");
  const [status, setStatus] = useState("");
  const [mine, setMine] = useState(false);
  const [review, setReview] = useState(false);
  const [calls, setCalls] = useState<CallSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (flag) params.set("flag", flag);
    if (status) params.set("status", status);
    if (mine) params.set("mine", "1");
    if (review) params.set("review", "1");
    const load = () =>
      orgFetch<CallSummary[]>(`/calls${params.toString() ? `?${params}` : ""}`)
        .then((rows) => {
          if (cancelled) return;
          setCalls(rows);
          setError(null);
        })
        .catch((e: Error) => !cancelled && setError(e.message));
    const timer = setTimeout(load, 250);
    // Calls being transcribed change status on their own; check again while any are.
    const poll = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(poll);
    };
  }, [query, flag, status, mine, review, visible]);

  if (!me) return null;
  if (!(me.modules ?? []).includes("transcription")) return <NoAccess text="Opptak og transkribering er ikke slått på for callsenteret." />;
  if (!visible) return <NoAccess text="Du har ikke tilgang til samtaler i dette callsenteret." />;

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Samtaler</h1>
          <p className="mt-2 text-muted">Opptak, transkripsjon og AI-kontroll mot produktmalen.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {permissions.includes("report_templates.manage") && (
            <Link href="/samtaler/rapportmaler" className={secondaryButton}>
              Rapportmaler
            </Link>
          )}
          {canRecord && (
            <Link href="/samtaler/opptak" className={primaryButton}>
              Nytt opptak
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <Field label="Søk i samtalene">
          <input
            type="search"
            className={`${inputClass} w-full sm:w-72`}
            placeholder="Ord fra samtalen, kunde eller tittel"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <Field label="AI-flagg">
          <select className={inputClass} value={flag} onChange={(e) => setFlag(e.target.value)}>
            <option value="">Alle</option>
            <option value="red">Brudd</option>
            <option value="yellow">Avvik</option>
            <option value="green">Godkjent</option>
          </select>
        </Field>
        <Field label="Status">
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Alle</option>
            {(Object.keys(CALL_STATUS) as CallStatus[]).map((s) => (
              <option key={s} value={s}>
                {CALL_STATUS[s]}
              </option>
            ))}
          </select>
        </Field>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          Bare mine
        </label>
        {canReview && (
          <label className="inline-flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} />
            Flagg som ikke er behandlet
          </label>
        )}
      </div>

      <ErrorMessage message={error} />
      {!calls ? (
        !error && <p className="text-muted">Laster …</p>
      ) : calls.length === 0 ? (
        <p className="text-muted">{query || flag || status || mine || review ? "Ingen samtaler passer filteret." : "Ingen samtaler ennå."}</p>
      ) : (
        <CallList calls={calls} />
      )}
      {calls?.length === 200 && <p className="text-sm text-muted">Viser de 200 siste. Bruk søk og filter for å finne eldre samtaler.</p>}
    </section>
  );
}
