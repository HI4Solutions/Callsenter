"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { Flag } from "@/components/flag";
import { Coaching } from "@/components/work/coaching";
import { CustomerPicker } from "@/components/work/customer-picker";
import { useWorkMe } from "@/components/work/work-shell";
import { CALL_STATUS, type CallDetail, FINDING_KIND, FLAG_LEVEL, formatDuration, SOURCE } from "@/lib/calls";
import { formatDate, formatDateTime } from "@/lib/format";
import { orgFetch } from "@/lib/org";
import type { Customer, ProductSummary } from "@/lib/work";


export default function CallPage() {
  const { id } = useParams<{ id: string }>();
  const me = useWorkMe();
  const permissions = me?.permissions ?? [];
  const [call, setCall] = useState<CallDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audio, setAudio] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const player = useRef<HTMLAudioElement>(null);

  const load = useCallback(
    () =>
      orgFetch<CallDetail>(`/calls/${id}`)
        .then(setCall)
        .catch((e: Error) => setError(e.message)),
    [id],
  );

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = () =>
      orgFetch<CallDetail>(`/calls/${id}`)
        .then((c) => !cancelled && setCall(c))
        .catch((e: Error) => !cancelled && setError(e.message));
    void fetchOnce();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // While the worker transcribes and checks the call, check its status every few seconds (a
  // status check is not logged as a view) and load it again when something has changed.
  // "working" is true while the worker holds the call, so this stops when nothing more will come.
  const waiting = call ? call.status === "processing" || call.working : false;
  useEffect(() => {
    if (!waiting || !call) return;
    const seen = `${call.status}/${call.analyses.length}/${call.reports.length}`;
    const timer = setInterval(() => {
      orgFetch<{ status: string; working: boolean; analyses: number; reports: number }>(`/calls/${id}?status=1`)
        .then((s) => {
          if (`${s.status}/${s.analyses}/${s.reports}` !== seen || !s.working) void load();
        })
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [waiting, call, id, load]);

  // Where to start when the player has loaded (a click on a timestamp before playback).
  const pendingSeek = useRef<number | null>(null);
  async function play(atMs?: number) {
    setError(null);
    const el = player.current;
    if (audio && el) {
      if (atMs !== undefined) el.currentTime = atMs / 1000;
      void el.play().catch(() => undefined);
      return;
    }
    try {
      pendingSeek.current = atMs ?? 0;
      setAudio((await orgFetch<{ url: string }>(`/calls/${id}/audio`)).url);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!call) return error ? <ErrorMessage message={error} /> : <p className="text-muted">Laster …</p>;
  const analysis = call.analyses[0];
  const canPlay = permissions.includes("calls.audio.play") && call.hasAudio;
  const q = search.trim().toLowerCase();
  const segments = q ? call.segments.filter((s) => s.text.toLowerCase().includes(q)) : call.segments;

  return (
    <section className="flex flex-col gap-8">
      <div>
        <Link href="/samtaler" className="text-sm font-semibold text-brand">
          ← Alle samtaler
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight [overflow-wrap:anywhere]">
            {call.title || call.customerName || call.productName || "Samtale"}
          </h1>
          {analysis ? (
            <Flag level={FLAG_LEVEL[analysis.flag]} />
          ) : (
            <span className="inline-flex items-center rounded-full border border-line px-3 py-1 text-sm font-medium">{CALL_STATUS[call.status]}</span>
          )}
        </div>
        <p className="mt-2 text-muted">
          {[formatDateTime(call.startedAt), call.userName, formatDuration(call.durationMs), SOURCE[call.source]].filter(Boolean).join(" · ")}
        </p>
      </div>
      <ErrorMessage message={error} />

      {call.status === "recording" && call.userId === me?.user.id && (
        <Card title="Opptaket er ikke fullført">
          <p className="text-muted">Opptaket ble ikke avsluttet. Det som er lastet opp, kan sendes til transkribering.</p>
          <button
            type="button"
            className={`${primaryButton} mt-4`}
            onClick={() => run(() => orgFetch(`/calls/${id}/complete`, { method: "POST", body: {} }))}
          >
            Fullfør opptaket
          </button>
        </Card>
      )}
      {waiting && call.status !== "recording" && (
        <p role="status">{call.status === "processing" ? "Samtalen transkriberes" : "AI sjekker samtalen"}. Siden oppdateres av seg selv.</p>
      )}
      {call.status === "failed" && (
        <Card title="Behandlingen feilet">
          <p>{call.error ?? "Noe gikk galt."}</p>
          {permissions.includes("calls.upload") && (
            <button type="button" className={`${primaryButton} mt-4`} onClick={() => run(() => orgFetch(`/calls/${id}/retry`, { method: "POST" }))}>
              Prøv igjen
            </button>
          )}
        </Card>
      )}

      {canPlay && (
        <Card title="Opptak">
          {audio ? (
            // A short-lived link; every playback is logged.
            <audio
              ref={player}
              src={audio}
              controls
              preload="metadata"
              className="w-full"
              // The link lasts ten minutes; after that the player shows the button again for a new one.
              onError={() => setAudio(null)}
              onLoadedMetadata={(e) => {
                if (pendingSeek.current === null) return;
                e.currentTarget.currentTime = pendingSeek.current / 1000;
                pendingSeek.current = null;
                void e.currentTarget.play().catch(() => undefined);
              }}
            />
          ) : (
            <button type="button" className={primaryButton} onClick={() => play()}>
              Spill av
            </button>
          )}
          <p className="mt-2 text-sm text-muted">Slettes automatisk {formatDate(call.expiresAt)}.</p>
        </Card>
      )}

      {analysis && <Analysis call={call} analysis={analysis} onSeek={canPlay ? play : undefined} onChanged={load} />}

      {call.segments.length > 0 && (
        <Card title="Transkripsjon">
          <Field label="Søk i samtalen">
            <input type="search" className={`${inputClass} sm:max-w-sm`} value={search} onChange={(e) => setSearch(e.target.value)} />
          </Field>
          <ol className="mt-4 flex flex-col gap-3">
            {segments.map((s) => (
              <li key={s.seq} className="flex gap-3">
                {canPlay ? (
                  <button
                    type="button"
                    className="min-h-11 shrink-0 self-start rounded-lg px-2 font-mono text-sm text-brand tabular-nums hover:bg-bg"
                    onClick={() => play(s.startMs)}
                    title="Spill av herfra"
                  >
                    {formatDuration(s.startMs)}
                  </button>
                ) : (
                  <span className="shrink-0 px-2 pt-1 font-mono text-sm text-muted tabular-nums">{formatDuration(s.startMs)}</span>
                )}
                <p className="min-w-0 pt-1 [overflow-wrap:anywhere]">
                  {s.speaker && <span className="mr-2 text-sm font-semibold text-muted">Taler {s.speaker}</span>}
                  {s.text}
                </p>
              </li>
            ))}
            {segments.length === 0 && <li className="text-muted">Ingen treff.</li>}
          </ol>
        </Card>
      )}

      {call.reports.map((r) => (
        <Card key={r.id} title={`Rapport: ${r.templateName}`}>
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{r.content}</p>
          <p className="mt-4 text-sm text-muted">Laget av AI {formatDateTime(r.createdAt)}. Kontroller mot opptaket ved tvil.</p>
        </Card>
      ))}

      {me?.modules?.includes("dashboard") && (
        <Coaching sellerId={call.userId} sellerName={call.userName} callId={call.id} title="Tilbakemelding på samtalen" />
      )}
      <Links call={call} canEdit={permissions.includes("calls.upload") && !call.analyses.length && !call.working} onChanged={load} />
    </section>
  );
}

function Analysis({
  call,
  analysis,
  onSeek,
  onChanged,
}: {
  call: CallDetail;
  analysis: CallDetail["analyses"][number];
  onSeek?: (ms: number) => void;
  onChanged: () => Promise<unknown>;
}) {
  const me = useWorkMe();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const order = { red: 0, yellow: 1, green: 2 } as const;
  const findings = [...analysis.findings].sort((a, b) => order[a.level] - order[b.level]);

  async function review(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await orgFetch(`/calls/${call.id}/analyses/${analysis.id}`, { method: "PATCH", body: { reviewNote: note.trim() || null } });
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card title="AI-kontroll">
      <p>{analysis.summary}</p>
      <p className="mt-1 text-sm text-muted">
        Sjekket mot {call.productName}, malversjon {call.templateVersion}. AI kan ta feil; sjekk sitatet i opptaket.
      </p>
      <ul className="mt-4 flex flex-col gap-3">
        {findings.map((f, i) => (
          <li key={i} className="rounded-lg border border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Flag level={FLAG_LEVEL[f.level]} />
              <span className="font-semibold">{f.label}</span>
              <span className="text-sm text-muted">{FINDING_KIND[f.kind]}</span>
            </div>
            {f.comment && <p className="mt-2">{f.comment}</p>}
            {f.quote && (
              <p className="mt-2 [overflow-wrap:anywhere]">
                {f.startMs !== null && onSeek ? (
                  <button type="button" className="mr-2 font-mono text-sm text-brand tabular-nums" onClick={() => onSeek(f.startMs!)}>
                    {formatDuration(f.startMs)}
                  </button>
                ) : null}
                «{f.quote}»
              </p>
            )}
          </li>
        ))}
      </ul>
      {analysis.flag !== "green" &&
        (analysis.reviewedAt ? (
          <p className="mt-4 rounded-lg bg-bg p-3">
            Behandlet {formatDateTime(analysis.reviewedAt)}
            {analysis.reviewedByName && ` av ${analysis.reviewedByName}`}
            {analysis.reviewNote && `: ${analysis.reviewNote}`}
          </p>
        ) : me?.permissions.includes("flags.review") ? (
          <form onSubmit={review} className="mt-4 flex flex-col gap-3">
            <Field label="Kommentar" hint="Hva er gjort med avviket, for eksempel tatt opp med selgeren eller kunden kontaktet.">
              <textarea rows={2} maxLength={2000} className={`${inputClass} py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <ErrorMessage message={error} />
            <div>
              <button type="submit" className={primaryButton}>
                Marker som behandlet
              </button>
            </div>
          </form>
        ) : (
          <p className="mt-4 text-sm text-muted">Ikke behandlet ennå.</p>
        ))}
    </Card>
  );
}

function Links({ call, canEdit, onChanged }: { call: CallDetail; canEdit: boolean; onChanged: () => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const [customer, setCustomer] = useState<Pick<Customer, "id" | "name"> | null>(
    call.customerId ? { id: call.customerId, name: call.customerName ?? "" } : null,
  );
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [productId, setProductId] = useState(call.productId ?? "");
  const [title, setTitle] = useState(call.title ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    orgFetch<ProductSummary[]>("/products")
      .then((rows) => !cancelled && setProducts(rows.filter((p) => p.publishedVersion !== null || p.id === call.productId)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [editing, call.productId]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await orgFetch(`/calls/${call.id}`, {
        method: "PATCH",
        body: {
          title: title.trim() || null,
          customerId: customer?.id ?? null,
          ...(call.saleId ? {} : { productId: productId || null }),
        },
      });
      await onChanged();
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card
      title="Koblinger"
      actions={
        canEdit &&
        !editing && (
          <button type="button" className={secondaryButton} onClick={() => setEditing(true)}>
            Endre
          </button>
        )
      }
    >
      {editing ? (
        <form onSubmit={save} className="flex flex-col gap-4">
          <Field label="Tittel">
            <input maxLength={200} className={`${inputClass} sm:max-w-md`} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <CustomerPicker value={customer} onChange={setCustomer} />
          {!call.saleId && (
            <Field label="Produkt" hint="Når et produkt kobles til, sjekkes samtalen mot gjeldende produktmal.">
              <select className={`${inputClass} sm:max-w-md`} value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Ikke valgt</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <ErrorMessage message={error} />
          <div className="flex gap-2">
            <button type="submit" className={primaryButton}>
              Lagre
            </button>
            <button type="button" className={secondaryButton} onClick={() => setEditing(false)}>
              Avbryt
            </button>
          </div>
        </form>
      ) : (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[12rem_1fr]">
          <dt className="text-sm font-semibold text-muted">Kunde</dt>
          <dd>{call.customerId ? <Link href={`/kunder/${call.customerId}`} className="font-semibold text-brand">{call.customerName}</Link> : "–"}</dd>
          <dt className="text-sm font-semibold text-muted">Salg</dt>
          <dd>{call.saleId ? <Link href={`/salg/${call.saleId}`} className="font-semibold text-brand">Se salget</Link> : "–"}</dd>
          <dt className="text-sm font-semibold text-muted">Produkt</dt>
          <dd>
            {call.productId ? (
              <Link href={`/produkter/${call.productId}`} className="font-semibold text-brand">
                {call.productName}
                {call.templateVersion && `, mal versjon ${call.templateVersion}`}
              </Link>
            ) : (
              "–"
            )}
          </dd>
        </dl>
      )}
    </Card>
  );
}
