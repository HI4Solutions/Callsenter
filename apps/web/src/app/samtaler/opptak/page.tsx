"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { AdditionalInfo } from "@/components/calls/additional-info";
import { NoteTemplatePicker, useNoteTemplates } from "@/components/calls/note-templates";
import { NotesPanel } from "@/components/calls/notes-panel";
import { TranscriptPanel } from "@/components/calls/transcript-panel";
import { useCall } from "@/components/calls/use-call";
import { WarningLamps } from "@/components/calls/warning-lamps";
import { CustomerPicker } from "@/components/work/customer-picker";
import { NoAccess, useWorkMe } from "@/components/work/work-shell";
import { CALL_STATUS, type CreatedCall, formatDuration, type RequiredPoint, recordingMime } from "@/lib/calls";
import { orgFetch } from "@/lib/org";
import { type Capture, CallRecorder, RecorderError, tabAudioSupported, tabShareActive, uploadFile } from "@/lib/recorder";
import type { Customer, ProductDetail, ProductSummary, SaleSummary } from "@/lib/work";

type State =
  | { step: "idle" }
  | { step: "starting" }
  | { step: "recording"; callId: string; live: boolean }
  | { step: "stopping"; callId: string }
  | { step: "uploading" };

// The template chosen in this tab is kept when the page is reloaded.
const TAB_PRODUCT = "veriqall.studio.product";

function readTabProduct(): string | null {
  try {
    return sessionStorage.getItem(TAB_PRODUCT);
  } catch {
    return null;
  }
}

function writeTabProduct(id: string) {
  try {
    if (id) sessionStorage.setItem(TAB_PRODUCT, id);
    else sessionStorage.removeItem(TAB_PRODUCT);
  } catch {
    // Not remembered in a private window; the choice still applies on this page.
  }
}

// The note templates switched on in this tab, kept the same way.
const TAB_NOTES = "veriqall.studio.notes";

function readTabNotes(): string[] | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(TAB_NOTES) ?? "null");
    return Array.isArray(value) && value.every((v) => typeof v === "string") ? value : null;
  } catch {
    return null;
  }
}

function writeTabNotes(ids: string[]) {
  try {
    sessionStorage.setItem(TAB_NOTES, JSON.stringify(ids));
  } catch {
    // As above.
  }
}

// Samtalestudio (docs/plan.md, section 18): record the call, see the transcript and the warning
// lamps for the product template, add information that was not said, and get the note. The
// transcript is made from the recording and cannot be changed; the seller may adjust the note.
export default function StudioPage() {
  const me = useWorkMe();
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [productId, setProductId] = useState("");
  const [starred, setStarred] = useState<string | null>(null);
  const [points, setPoints] = useState<RequiredPoint[]>([]);
  const [customer, setCustomer] = useState<Pick<Customer, "id" | "name"> | null>(null);
  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [saleId, setSaleId] = useState("");
  const [title, setTitle] = useState("");
  const [extraInfo, setExtraInfo] = useState("");
  const [capture, setCapture] = useState<Capture>("microphone");
  const [state, setState] = useState<State>({ step: "idle" });
  // The call made in this round, kept after the recording stops so its note shows here.
  const [doneId, setDoneId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [liveText, setLiveText] = useState({ final: "", partial: "" });
  const [uploads, setUploads] = useState({
    uploaded: 0,
    pending: 0,
    failing: false,
  });
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<CallRecorder | null>(null);
  const [tabSupported] = useState(() => tabAudioSupported());
  const [tabShared, setTabShared] = useState(() => tabShareActive());
  const { call, load, waiting } = useCall(doneId);
  const noteTemplates = useNoteTemplates(me?.modules?.includes("reports") ?? false);
  const [notes, setNotes] = useState<string[] | null>(null);
  // Before anything is chosen in this tab: the call centre's default note template.
  const chosenNotes =
    notes ??
    (noteTemplates ? (readTabNotes() ?? noteTemplates.filter((t) => t.isDefault).map((t) => t.id)) : []).filter((id) =>
      noteTemplates?.some((t) => t.id === id),
    );

  // Products with a published template, and which one to start with: the one chosen in this tab,
  // then the member's own default (the star).
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      orgFetch<ProductSummary[]>("/products"),
      orgFetch<{ productId: string | null }>("/studio").catch(() => ({
        productId: null,
      })),
    ])
      .then(([rows, studio]) => {
        if (cancelled) return;
        const published = rows.filter((p) => p.publishedVersion !== null && !p.archivedAt);
        setProducts(published);
        setStarred(studio.productId);
        const tab = readTabProduct();
        const start =
          [tab, studio.productId].find((id) => id && published.some((p) => p.id === id)) ??
          (published.length === 1 ? published[0]!.id : "");
        setProductId(start);
      })
      .catch(() => !cancelled && setProducts([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const sale = sales.find((s) => s.id === saleId);
  const templateProduct = sale?.productId ?? productId;
  // The mandatory points of the chosen template, for the lamps before the AI control has run.
  useEffect(() => {
    if (!templateProduct) return;
    let cancelled = false;
    orgFetch<ProductDetail>(`/products/${templateProduct}`)
      .then((p) => !cancelled && setPoints(p.versions.find((v) => v.status === "published")?.requiredPoints ?? []))
      .catch(() => !cancelled && setPoints([]));
    return () => {
      cancelled = true;
    };
  }, [templateProduct]);

  // The customer's sales, so the call can be linked to the sale it belongs to.
  useEffect(() => {
    if (!customer) return;
    let cancelled = false;
    orgFetch<SaleSummary[]>(`/sales?customerId=${customer.id}`)
      .then((rows) => !cancelled && setSales(rows))
      .catch(() => !cancelled && setSales([]));
    return () => {
      cancelled = true;
    };
  }, [customer]);

  // Leaving the page stops the microphone; the uploaded part can be finished from the call page.
  useEffect(() => () => recorder.current?.abort(), []);

  const recording = state.step === "recording" || state.step === "stopping";
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setElapsed(recorder.current?.elapsedMs ?? 0), 500);
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => {
      clearInterval(timer);
      window.removeEventListener("beforeunload", warn);
    };
  }, [recording]);

  if (!me) return null;
  if (!me.permissions.includes("calls.upload")) return <NoAccess text="Du har ikke tilgang til å ta opp samtaler." />;

  const activeId = state.step === "recording" || state.step === "stopping" ? state.callId : doneId;
  const analysed = Boolean(call?.analyses.length);
  const busy = state.step !== "idle";

  const links = () => ({
    title: title.trim() || null,
    customerId: customer?.id ?? null,
    saleId: saleId || null,
    productId: saleId ? null : productId || null,
    noteTemplateIds: chosenNotes,
  });

  // Saves what was typed before the call existed.
  async function afterCreate(id: string) {
    if (extraInfo.trim())
      await orgFetch(`/calls/${id}`, {
        method: "PATCH",
        body: { note: extraInfo.trim() },
      }).catch(() => undefined);
  }

  // A new round. After a finished call everything starts afresh ("Ny samtale"); before the
  // first one, what was filled in is kept.
  function reset(all = Boolean(doneId)) {
    setDoneId(null);
    setLiveText({ final: "", partial: "" });
    setNotice(null);
    setError(null);
    setElapsed(0);
    if (!all) return;
    setExtraInfo("");
    setCustomer(null);
    setSales([]);
    setSaleId("");
    setTitle("");
  }

  async function chooseNotes(ids: string[]) {
    setError(null);
    setNotes(ids);
    writeTabNotes(ids);
    // Until the notes after the call are written, they follow the choice.
    if (activeId && !call?.reports.length) {
      await orgFetch(`/calls/${activeId}`, { method: "PATCH", body: { noteTemplateIds: ids } }).catch((e: Error) => setError(e.message));
    }
  }

  async function chooseProduct(id: string) {
    setError(null);
    setProductId(id);
    writeTabProduct(id);
    // The template can be changed during and after the recording, until the AI control has run.
    if (activeId && !saleId && !analysed) {
      try {
        await orgFetch(`/calls/${activeId}`, {
          method: "PATCH",
          body: { productId: id || null },
        });
        if (doneId) await load();
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }

  async function toggleStar() {
    if (!productId) return;
    const next = starred === productId ? null : productId;
    try {
      await orgFetch("/studio", { method: "PUT", body: { productId: next } });
      setStarred(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function start() {
    reset();
    setState({ step: "starting" });
    const mime = recordingMime((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t));
    let rec: CallRecorder;
    try {
      rec = await CallRecorder.open(capture, mime, {
        onLiveText: (final, partial) => setLiveText({ final, partial }),
        onRealtimeLost: () => {
          setNotice("Sanntidsteksten falt ut. Opptaket fortsetter, og teksten kommer nå bitvis, omtrent hvert 15. sekund.");
          setState((s) => (s.step === "recording" ? { ...s, live: false } : s));
        },
        onUploads: setUploads,
        onUploadFatal: (message) => setError(`${message} Opptaket stoppes ikke, men nye deler lagres ikke.`),
        onTabEnded: () => {
          setTabShared(false);
          setNotice("Fanedelingen ble avsluttet. Stopp opptaket, eller fortsett med bare mikrofonen.");
        },
      });
    } catch (e) {
      setError(e instanceof RecorderError ? e.message : "Kunne ikke starte opptaket.");
      setState({ step: "idle" });
      return;
    }
    setTabShared(tabShareActive());
    try {
      const created = await orgFetch<CreatedCall>("/calls", {
        method: "POST",
        body: { source: capture, mime, ...links() },
      });
      recorder.current = rec;
      rec.start(created);
      setElapsed(0);
      setUploads({ uploaded: 0, pending: 0, failing: false });
      setState({
        step: "recording",
        callId: created.id,
        live: Boolean(created.realtime),
      });
      void afterCreate(created.id);
    } catch (e) {
      rec.release();
      setError((e as Error).message);
      setState({ step: "idle" });
    }
  }

  async function stop() {
    if (state.step !== "recording" || !recorder.current) return;
    const callId = state.callId;
    setState({ step: "stopping", callId });
    try {
      await recorder.current.stop();
      setDoneId(callId);
    } catch (e) {
      setError(`${(e as Error).message} Opptaket er lagret; du kan fullføre det fra samtalesiden.`);
      setDoneId(callId);
    }
    setState({ step: "idle" });
  }

  async function upload(file: File) {
    if (!file.type.startsWith("audio/")) {
      setError("Velg en lydfil (for eksempel mp3, m4a, wav eller webm).");
      return;
    }
    reset();
    setState({ step: "uploading" });
    try {
      const created = await orgFetch<CreatedCall>("/calls", {
        method: "POST",
        body: { source: "upload", mime: file.type, ...links() },
      });
      await afterCreate(created.id);
      await uploadFile(created.id, file);
      setDoneId(created.id);
    } catch (e) {
      setError((e as Error).message);
    }
    setState({ step: "idle" });
  }

  const lampPoints = call?.templateVersionId ? call.requiredPoints : points;
  const lampState = recording ? "recording" : !call ? "before" : waiting ? "checking" : "off";
  const statusText = !call
    ? undefined
    : call.status === "failed"
      ? (call.error ?? "Behandlingen feilet.")
      : call.status === "processing" || call.status === "recording"
        ? `${CALL_STATUS[call.status]}. Siden oppdateres av seg selv.`
        : undefined;

  return (
    <section className="flex flex-col gap-6">
      <div>
        <Link href="/samtaler" className="text-sm font-semibold text-brand">
          ← Alle samtaler
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Samtalestudio</h1>
        <p className="mt-2 text-muted">Kunden skal vite at samtalen tas opp. Velg malen samtalen skal sjekkes mot før du starter.</p>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 sm:p-6">
        <div className="flex min-w-0 items-end gap-2">
          <div className="min-w-0 flex-1 sm:max-w-md">
            <Field label="Mal">
              <select
                className={`${inputClass} w-full`}
                value={sale ? sale.productId : productId}
                disabled={Boolean(sale) || analysed}
                onChange={(e) => void chooseProduct(e.target.value)}
              >
                <option value="">{products ? "Ingen mal (ingen AI-kontroll)" : "Laster …"}</option>
                {products?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.id === starred ? " ★" : ""}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {productId && !sale && (
            <button
              type="button"
              className={`${secondaryButton} px-3`}
              aria-pressed={starred === productId}
              onClick={toggleStar}
              title={starred === productId ? "Fjern som standardmal" : "Sett som standardmal for Samtalestudio"}
            >
              <span aria-hidden="true">{starred === productId ? "★" : "☆"}</span>
              <span className="sr-only">{starred === productId ? "Fjern som standardmal" : "Sett som standardmal for Samtalestudio"}</span>
            </button>
          )}
        </div>
        {me.modules?.includes("reports") && (
          <NoteTemplatePicker templates={noteTemplates} chosen={chosenNotes} onChange={(ids) => void chooseNotes(ids)} />
        )}
        <div className="flex flex-wrap items-center gap-3">
          {recording ? (
            <button type="button" className={primaryButton} disabled={state.step === "stopping"} onClick={stop}>
              {state.step === "stopping" ? "Laster opp resten …" : "Stopp og send"}
            </button>
          ) : (
            <button type="button" className={primaryButton} disabled={busy} onClick={start}>
              {state.step === "starting" ? "Starter …" : "Start opptak"}
            </button>
          )}
          {recording ? (
            <span className="text-2xl font-bold tabular-nums" aria-live="off">
              {formatDuration(elapsed)}
            </span>
          ) : (
            <label className={`${secondaryButton} cursor-pointer`}>
              {state.step === "uploading" ? "Laster opp …" : "Last opp lydfil"}
              <input
                type="file"
                accept="audio/*"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void upload(file);
                }}
              />
            </label>
          )}
        </div>

        {!recording && (
          <fieldset className="flex min-w-0 flex-wrap gap-x-6 gap-y-2">
            <legend className="mb-1 text-sm font-semibold">Hvor går samtalen?</legend>
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="capture" checked={capture === "microphone"} onChange={() => setCapture("microphone")} />
              Mikrofon
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="capture" disabled={!tabSupported} checked={capture === "tab"} onChange={() => setCapture("tab")} />
              Ekstern løsning (fanelyd)
            </label>
          </fieldset>
        )}
        {!recording && capture === "tab" && (
          <ol className="list-decimal space-y-1 rounded-lg bg-bg p-3 pl-8 text-sm">
            {tabShared ? (
              <li>Fanen deles allerede, og brukes på nytt uten ny dialog.</li>
            ) : (
              <>
                <li>Start samtalen i nettleserfanen (nettbasert telefoni, Teams, Zoom o.l.). Bare Chrome og Edge på PC og Mac.</li>
                <li>Trykk «Start opptak» og velg fanen der samtalen går.</li>
                <li>Huk av for «Del fanelyd». Uten den kommer det ingen lyd fra fanen.</li>
                <li>Trykk «Del». Bruk hodetelefoner, så kommer kunden bare inn via fanelyden.</li>
              </>
            )}
          </ol>
        )}
        {recording && (
          <p className="text-sm text-muted" role="status">
            {capture === "tab" ? (tabShared ? "Deler fane og mikrofon. " : "Bare mikrofon. ") : "Mikrofon. "}
            {uploads.uploaded} {uploads.uploaded === 1 ? "del" : "deler"} lagret
            {uploads.pending > 0 && `, ${uploads.pending} venter`}.
            {uploads.failing && " Får ikke lastet opp akkurat nå; prøver igjen. Ikke lukk siden."}
          </p>
        )}
        {notice && <p className="rounded-lg border border-line p-3">{notice}</p>}
        <ErrorMessage message={error} />

        {!activeId && (
          <details className="rounded-lg border border-line p-3">
            <summary className="min-h-11 cursor-pointer content-center font-semibold">
              Kunde, salg og tittel{customer ? `: ${customer.name}` : ""}
            </summary>
            <div className="mt-3 flex flex-col gap-4">
              <CustomerPicker
                value={customer}
                onChange={(c) => {
                  setCustomer(c);
                  setSaleId("");
                  setSales([]);
                }}
                hint="Valgfritt. Kan også kobles etterpå."
              />
              {customer && sales.length > 0 && (
                <Field label="Salg" hint="Velg salget samtalen gjelder, så brukes malversjonen salget ble gjort på.">
                  <select className={`${inputClass} sm:max-w-md`} value={saleId} onChange={(e) => setSaleId(e.target.value)}>
                    <option value="">Ikke koblet til et salg</option>
                    {sales.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.productName}, {new Date(s.soldAt).toLocaleDateString("nb-NO")}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Tittel" hint="Valgfritt.">
                <input maxLength={200} className={`${inputClass} sm:max-w-md`} value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
            </div>
          </details>
        )}
        {doneId && !busy && (
          <div className="flex flex-wrap gap-2">
            <Link href={`/samtaler/${doneId}`} className={secondaryButton}>
              Åpne samtalen
            </Link>
            <button type="button" className={secondaryButton} onClick={() => reset(true)}>
              Ny samtale
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Varsellamper">
            <WarningLamps points={lampPoints} analysis={call?.analyses[0]} state={lampState} />
          </Card>
          <TranscriptPanel
            segments={call?.segments ?? []}
            live={recording || (!call && liveText.final) ? { ...liveText, on: state.step === "recording" && state.live } : null}
            status={statusText ?? (call ? undefined : "Start opptaket, så kommer teksten her.")}
          />
          <AdditionalInfo
            key={activeId ?? "new"}
            value={call?.note ?? extraInfo}
            canEdit={!call || call.isOwn}
            onChange={setExtraInfo}
            onSave={
              activeId
                ? async (text) => {
                    await orgFetch(`/calls/${activeId}`, {
                      method: "PATCH",
                      body: { note: text.trim() || null },
                    });
                  }
                : null
            }
            hint={
              call?.reports.some((r) => r.status === "done")
                ? "Brukes når et notat lages. Har du endret den, trykk «Regenerer» for et nytt notat. AI-kontrollen bruker bare det som ble sagt."
                : undefined
            }
          />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          {call ? (
            <NotesPanel call={call} onChanged={load} chosen={chosenNotes} />
          ) : (
            <Card title="Notater">
              <p className="text-muted">Notatet lages av AI når samtalen er transkribert, ut fra transkripsjonen og malen.</p>
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}
