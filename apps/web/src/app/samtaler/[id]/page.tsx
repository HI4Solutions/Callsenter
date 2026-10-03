"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton, LoadState } from "@/components/admin/field";
import { AdditionalInfo } from "@/components/calls/additional-info";
import { CallLog } from "@/components/calls/call-log";
import { CallStatusBadge } from "@/components/calls/call-status";
import { NotesPanel } from "@/components/calls/notes-panel";
import { TranscriptPanel } from "@/components/calls/transcript-panel";
import { useCall } from "@/components/calls/use-call";
import { Flag } from "@/components/flag";
import { Coaching } from "@/components/work/coaching";
import { CustomerPicker } from "@/components/work/customer-picker";
import { useWorkMe } from "@/components/work/work-shell";
import { type CallDetail, FINDING_KIND, FLAG_LEVEL, formatDuration, SOURCE } from "@/lib/calls";
import { formatDate, formatDateTime } from "@/lib/format";
import { orgFetch } from "@/lib/org";
import type { Customer, ProductSummary } from "@/lib/work";


export default function CallPage() {
  const { id } = useParams<{ id: string }>();
  const me = useWorkMe();
  const permissions = me?.permissions ?? [];
  const { call, error, setError, load, waiting } = useCall(id);
  const [audio, setAudio] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement>(null);

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

  if (!call) return <LoadState error={error} />;
  const analysis = call.analyses[0];
  const canPlay = permissions.includes("calls.audio.play") && call.hasAudio;
  // Recording and transcript to the right from lg (and first on a phone), the rest to the left.
  const side = canPlay || call.segments.length > 0;

  return (
    <section className="flex flex-col gap-8">
      <div>
        <Link href="/samtaler" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand">
          ← Alle samtaler
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight [overflow-wrap:anywhere]">
            {call.title || call.customerName || call.productName || "Samtale"}
          </h1>
          {analysis ? <Flag level={FLAG_LEVEL[analysis.flag]} /> : <CallStatusBadge status={call.status} />}
        </div>
        <p className="mt-2 text-muted">
          {[formatDateTime(call.startedAt), call.userName, formatDuration(call.durationMs), SOURCE[call.source]].filter(Boolean).join(" · ")}
        </p>
        <Links call={call} canEdit={permissions.includes("calls.upload") && !call.analyses.length && !call.working} onChanged={load} />
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
        <p role="status">
          {call.status === "processing" ? "Samtalen transkriberes" : call.working ? "AI sjekker samtalen" : "Notatet skrives"}. Siden oppdateres av seg
          selv.
        </p>
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

      <div className={`grid gap-8 lg:items-start [&>*]:min-w-0 ${side ? "lg:grid-cols-2" : ""}`}>
        {side && (
          <div className="flex flex-col gap-8 lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
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
            {call.segments.length > 0 && <TranscriptPanel segments={call.segments} onSeek={canPlay ? play : undefined} />}
          </div>
        )}

        <div className="flex flex-col gap-8 lg:col-start-1 lg:row-start-1">
          {analysis && <Analysis call={call} analysis={analysis} onSeek={canPlay ? play : undefined} onChanged={load} />}

          <NotesPanel call={call} onChanged={load} />

          <AdditionalInfo
            key={call.id}
            value={call.note ?? ""}
            canEdit={call.isOwn && permissions.includes("calls.upload")}
            onSave={async (text) => {
              await orgFetch(`/calls/${call.id}`, { method: "PATCH", body: { note: text.trim() || null } });
              await load();
            }}
          />

          {me?.modules?.includes("dashboard") && (
            <Coaching sellerId={call.userId} sellerName={call.userName} callId={call.id} title="Tilbakemelding på samtalen" />
          )}
          {permissions.includes("audit.read") && <CallLog callId={call.id} />}
        </div>
      </div>
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
                  <button
                    type="button"
                    className="-my-2 mr-1 inline-flex min-h-11 items-center rounded-lg px-2 font-mono text-sm text-brand hover:bg-bg"
                    onClick={() => onSeek(f.startMs!)}
                    title="Spill av herfra"
                  >
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

  if (editing) {
    return (
      <div className="mt-4">
        <Card title="Koblinger">
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
        </Card>
      </div>
    );
  }

  // Customer, sale and product right under the title, where they are looked for.
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
      <dl className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <div className="flex gap-1.5">
          <dt className="text-muted">Kunde:</dt>
          <dd>{call.customerId ? <Link href={`/kunder/${call.customerId}`} className="font-semibold text-brand">{call.customerName}</Link> : "–"}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted">Salg:</dt>
          <dd>{call.saleId ? <Link href={`/salg/${call.saleId}`} className="font-semibold text-brand">Se salget</Link> : "–"}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted">Produkt:</dt>
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
        </div>
      </dl>
      {canEdit && (
        <button type="button" className="inline-flex min-h-11 items-center font-semibold text-brand" onClick={() => setEditing(true)}>
          Endre koblinger
        </button>
      )}
    </div>
  );
}
