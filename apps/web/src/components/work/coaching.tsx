"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { useWorkMe } from "@/components/work/work-shell";
import { COACHING_KIND, type CoachingList, type CoachingNote } from "@/lib/dashboard";
import { formatDateTime } from "@/lib/format";
import { orgFetch } from "@/lib/org";

// Feedback to one seller: the list, and a form for leaders with coaching.give. The seller marks
// feedback as read. With callId, only the feedback about that call is shown, and new feedback is
// linked to it.
export function Coaching({
  sellerId,
  sellerName,
  callId,
  title = "Tilbakemeldinger",
}: {
  sellerId: string;
  sellerName?: string | null;
  callId?: string;
  title?: string;
}) {
  const me = useWorkMe();
  const own = me?.user.id === sellerId;
  const [notes, setNotes] = useState<CoachingNote[] | null>(null);
  // From the database (app.can_coach): coaching.give, and the seller is in the leader's team.
  const [canGive, setCanGive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = `/coaching?sellerId=${sellerId}${callId ? `&callId=${callId}` : ""}`;
  const load = useCallback(
    () =>
      orgFetch<CoachingList>(query)
        .then((r) => {
          setNotes(r.notes);
          setCanGive(r.canCoach && !own);
          setError(null);
        })
        .catch((e: Error) => setError(e.message)),
    [query, own],
  );

  useEffect(() => {
    let cancelled = false;
    orgFetch<CoachingList>(query)
      .then((r) => {
        if (cancelled) return;
        setNotes(r.notes);
        setCanGive(r.canCoach && !own);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [query, own]);

  async function markRead(id: string) {
    setError(null);
    try {
      await orgFetch(`/coaching/${id}/read`, { method: "POST" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Leaders who cannot coach this seller see nothing (the database returns nothing either), and
  // a call without feedback shows nothing to its seller.
  if (!canGive && !notes?.length && (!own || callId)) return null;

  return (
    <Card title={title}>
      {canGive && <NewNote sellerId={sellerId} sellerName={sellerName} callId={callId} onSaved={load} />}
      <ErrorMessage message={error} />
      {!notes ? (
        !error && <p className="text-muted">Laster …</p>
      ) : notes.length === 0 ? (
        <p className={`text-muted ${canGive ? "mt-6" : ""}`}>{own ? "Ingen tilbakemeldinger ennå." : "Ingen tilbakemeldinger gitt ennå."}</p>
      ) : (
        <ol className={`flex flex-col gap-4 ${canGive ? "mt-6" : ""}`}>
          {notes.map((n) => (
            <li key={n.id} className="border-l-2 border-line pl-4">
              <p className="font-semibold">
                {COACHING_KIND[n.kind]}
                {own && !n.readAt && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-xs text-on-brand">Ny</span>}
              </p>
              <p className="text-sm text-muted">
                {formatDateTime(n.createdAt)} · {n.authorName}
                {!callId && n.callId && (
                  <>
                    {" · "}
                    <Link href={`/samtaler/${n.callId}`} className="text-brand">
                      {n.callTitle || `Samtale ${n.callStartedAt ? formatDateTime(n.callStartedAt) : ""}`}
                    </Link>
                  </>
                )}
                {!own && (n.readAt ? ` · lest ${formatDateTime(n.readAt)}` : " · ikke lest")}
              </p>
              <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{n.body}</p>
              {own && !n.readAt && (
                <button type="button" className={`${secondaryButton} mt-2`} onClick={() => markRead(n.id)}>
                  Merk som lest
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function NewNote({
  sellerId,
  sellerName,
  callId,
  onSaved,
}: {
  sellerId: string;
  sellerName?: string | null;
  callId?: string;
  onSaved: () => Promise<unknown>;
}) {
  const [kind, setKind] = useState<CoachingNote["kind"]>("improve");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await orgFetch("/coaching", { method: "POST", body: { sellerId, callId: callId ?? null, kind, body: body.trim() } });
      setBody("");
      setSaved(true);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-2 text-sm font-semibold">Ny tilbakemelding{sellerName ? ` til ${sellerName}` : ""}</legend>
        {(Object.keys(COACHING_KIND) as CoachingNote["kind"][]).map((k) => (
          <label key={k} className="inline-flex min-h-11 items-center gap-2">
            <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
            {COACHING_KIND[k]}
          </label>
        ))}
      </fieldset>
      <Field label="Tilbakemelding" hint="Vær konkret: hva skjedde, og hva kan gjøres annerledes neste gang. Kan ikke endres etterpå.">
        <textarea rows={3} maxLength={4000} className={`${inputClass} py-2`} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <ErrorMessage message={error} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy || !body.trim()} className={primaryButton}>
          Gi tilbakemelding
        </button>
        {saved && <span role="status">Sendt.</span>}
      </div>
    </form>
  );
}
