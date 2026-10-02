"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { CustomerPicker } from "@/components/work/customer-picker";
import { NoAccess, useWorkMe } from "@/components/work/work-shell";
import { type CreatedCall, formatDuration, recordingMime } from "@/lib/calls";
import { orgFetch } from "@/lib/org";
import { type Capture, CallRecorder, RecorderError, tabAudioSupported, tabShareActive, uploadFile } from "@/lib/recorder";
import type { Customer, ProductSummary, SaleSummary } from "@/lib/work";

type State =
  | { step: "idle" }
  | { step: "starting" }
  | { step: "recording"; callId: string; live: boolean }
  | { step: "stopping"; callId: string }
  | { step: "uploading" };

export default function RecordPage() {
  const me = useWorkMe();
  const router = useRouter();
  const [customer, setCustomer] = useState<Pick<Customer, "id" | "name"> | null>(null);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [productId, setProductId] = useState("");
  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [saleId, setSaleId] = useState("");
  const [title, setTitle] = useState("");
  const [capture, setCapture] = useState<Capture>("microphone");
  const [state, setState] = useState<State>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [liveText, setLiveText] = useState({ final: "", partial: "" });
  const [uploads, setUploads] = useState({ uploaded: 0, pending: 0, failing: false });
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<CallRecorder | null>(null);
  const [tabSupported] = useState(() => tabAudioSupported());
  const [tabShared, setTabShared] = useState(() => tabShareActive());

  useEffect(() => {
    let cancelled = false;
    orgFetch<ProductSummary[]>("/products")
      .then((rows) => !cancelled && setProducts(rows.filter((p) => p.publishedVersion !== null)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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

  const links = () => ({
    title: title.trim() || null,
    customerId: customer?.id ?? null,
    saleId: saleId || null,
    productId: saleId ? null : productId || null,
  });

  async function start() {
    setError(null);
    setNotice(null);
    setLiveText({ final: "", partial: "" });
    setState({ step: "starting" });
    const mime = recordingMime((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t));
    let rec: CallRecorder;
    try {
      rec = await CallRecorder.open(capture, mime, {
        onLiveText: (final, partial) => setLiveText({ final, partial }),
        onRealtimeLost: () => {
          setNotice("Sanntidsteksten falt ut. Opptaket fortsetter, og teksten kommer når samtalen er ferdig behandlet.");
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
      const call = await orgFetch<CreatedCall>("/calls", {
        method: "POST",
        body: { source: capture, mime, ...links() },
      });
      recorder.current = rec;
      rec.start(call);
      setElapsed(0);
      setUploads({ uploaded: 0, pending: 0, failing: false });
      setState({ step: "recording", callId: call.id, live: Boolean(call.realtime) });
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
      router.push(`/samtaler/${callId}`);
    } catch (e) {
      setError(`${(e as Error).message} Opptaket er lagret; du kan fullføre det fra samtalesiden.`);
      setState({ step: "idle" });
    }
  }

  async function upload(file: File) {
    setError(null);
    if (!file.type.startsWith("audio/")) {
      setError("Velg en lydfil (for eksempel mp3, m4a, wav eller webm).");
      return;
    }
    setState({ step: "uploading" });
    try {
      const call = await orgFetch<CreatedCall>("/calls", { method: "POST", body: { source: "upload", mime: file.type, ...links() } });
      await uploadFile(call.id, file);
      router.push(`/samtaler/${call.id}`);
    } catch (e) {
      setError((e as Error).message);
      setState({ step: "idle" });
    }
  }

  const busy = state.step !== "idle";
  return (
    <section className="flex flex-col gap-8">
      <div>
        <Link href="/samtaler" className="text-sm font-semibold text-brand">
          ← Alle samtaler
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Nytt opptak</h1>
        <p className="mt-2 text-muted">
          Kunden skal vite at samtalen tas opp. Koble opptaket til produktet eller salget, så sjekkes samtalen mot produktmalen.
        </p>
      </div>

      {state.step === "recording" || state.step === "stopping" ? (
        <Card title={state.step === "stopping" ? "Avslutter …" : "Opptak pågår"}>
          <div className="flex flex-col gap-4">
            <p className="text-4xl font-bold tabular-nums" aria-live="off">
              {formatDuration(elapsed)}
            </p>
            <p className="text-sm text-muted" role="status">
              {capture === "tab" ? (tabShared ? "Deler fane og mikrofon. " : "Bare mikrofon. ") : "Mikrofon. "}
              {uploads.uploaded} {uploads.uploaded === 1 ? "del" : "deler"} lagret
              {uploads.pending > 0 && `, ${uploads.pending} venter`}.
              {uploads.failing && " Får ikke lastet opp akkurat nå; prøver igjen. Ikke lukk siden."}
            </p>
            {notice && <p className="rounded-lg border border-line p-3">{notice}</p>}
            {state.step === "recording" && state.live && (
              <div aria-live="polite" className="max-h-80 overflow-y-auto rounded-lg bg-bg p-3 [overflow-wrap:anywhere]">
                {liveText.final || liveText.partial ? (
                  <p className="whitespace-pre-wrap">
                    {liveText.final}
                    <span className="text-muted">{liveText.partial}</span>
                  </p>
                ) : (
                  <p className="text-muted">Teksten kommer her mens dere snakker …</p>
                )}
              </div>
            )}
            <div>
              <button type="button" className={primaryButton} disabled={state.step === "stopping"} onClick={stop}>
                {state.step === "stopping" ? "Laster opp resten …" : "Stopp og send"}
              </button>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <Card title="Koble til">
            <div className="flex flex-col gap-4">
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
              {!saleId && (
                <Field label="Produkt" hint="Samtalen sjekkes mot gjeldende produktmal.">
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
              <Field label="Tittel" hint="Valgfritt.">
                <input maxLength={200} className={`${inputClass} sm:max-w-md`} value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card title="Ta opp">
            <div className="flex flex-col gap-4">
              <fieldset className="flex min-w-0 flex-col gap-3">
                <legend className="mb-1 text-sm font-semibold">Hvor går samtalen?</legend>
                <label className="flex min-h-11 items-start gap-3">
                  <input type="radio" name="capture" className="mt-1" checked={capture === "microphone"} onChange={() => setCapture("microphone")} />
                  <span>
                    <span className="font-semibold">Mikrofon</span>
                    <span className="block text-sm text-muted">Telefonen på høyttaler, eller et møte i samme rom.</span>
                  </span>
                </label>
                <label className="flex min-h-11 items-start gap-3">
                  <input
                    type="radio"
                    name="capture"
                    className="mt-1"
                    disabled={!tabSupported}
                    checked={capture === "tab"}
                    onChange={() => setCapture("tab")}
                  />
                  <span>
                    <span className="font-semibold">Ekstern løsning (fanelyd)</span>
                    <span className="block text-sm text-muted">
                      Nettbasert telefoni, Teams, Whereby, Zoom o.l. i en nettleserfane. Bare Chrome og Edge på PC og Mac.
                    </span>
                  </span>
                </label>
              </fieldset>
              {capture === "tab" && (
                <ol className="list-decimal space-y-1 rounded-lg bg-bg p-3 pl-8 text-sm">
                  {tabShared ? (
                    <li>Fanen deles allerede, og brukes på nytt uten ny dialog.</li>
                  ) : (
                    <>
                      <li>Start samtalen i nettleserfanen som vanlig.</li>
                      <li>Trykk «Start opptak» og velg fanen der samtalen går.</li>
                      <li>Huk av for «Del fanelyd». Uten den kommer det ingen lyd fra fanen.</li>
                      <li>Trykk «Del». Bruk hodetelefoner, så kommer kunden bare inn via fanelyden.</li>
                    </>
                  )}
                </ol>
              )}
              <ErrorMessage message={error} />
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className={primaryButton} disabled={busy} onClick={start}>
                  {state.step === "starting" ? "Starter …" : "Start opptak"}
                </button>
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
              </div>
            </div>
          </Card>
        </>
      )}
    </section>
  );
}
