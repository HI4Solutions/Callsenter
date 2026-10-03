"use client";

import { isLocale, MAX_CHUNK_BYTES } from "@veriqall/shared";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/admin/card";
import {
  ErrorMessage,
  Field,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/components/admin/field";
import { AdditionalInfo } from "@/components/calls/additional-info";
import {
  type CallLanguageChoice,
  CallLanguages,
} from "@/components/calls/call-languages";
import { CallReference } from "@/components/calls/call-reference";
import {
  NoteTemplatePicker,
  useNoteTemplates,
} from "@/components/calls/note-templates";
import { NotesPanel } from "@/components/calls/notes-panel";
import { TranscriptPanel } from "@/components/calls/transcript-panel";
import { useCall } from "@/components/calls/use-call";
import { WarningLamps } from "@/components/calls/warning-lamps";
import { CustomerPicker } from "@/components/work/customer-picker";
import { NoAccess, useWorkMe } from "@/components/work/work-shell";
import {
  type CreatedCall,
  formatDuration,
  type RequiredPoint,
  recordingMime,
} from "@/lib/calls";
import { formatTagNow } from "@/lib/format";
import { orgFetch } from "@/lib/org";
import {
  type Capture,
  CallRecorder,
  RecorderError,
  tabAudioSupported,
  tabShareActive,
  uploadFile,
} from "@/lib/recorder";
import type {
  Customer,
  ProductDetail,
  ProductSummary,
  SaleSummary,
} from "@/lib/work";

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

// The languages chosen in this browser (notes and spoken), kept until changed: a seller usually
// calls in the same languages all day.
const STUDIO_LANGUAGES = "veriqall.studio.languages";

function readLanguages(): CallLanguageChoice {
  try {
    const value = JSON.parse(
      localStorage.getItem(STUDIO_LANGUAGES) ?? "null",
    ) as Partial<CallLanguageChoice> | null;
    return {
      outputLocale: isLocale(value?.outputLocale) ? value.outputLocale : null,
      spokenLanguages:
        Array.isArray(value?.spokenLanguages) &&
        value.spokenLanguages.every((v) => typeof v === "string")
          ? value.spokenLanguages
          : null,
    };
  } catch {
    return { outputLocale: null, spokenLanguages: null };
  }
}

function writeLanguages(choice: CallLanguageChoice) {
  try {
    localStorage.setItem(STUDIO_LANGUAGES, JSON.stringify(choice));
  } catch {
    // Not remembered; the choice still applies on this page.
  }
}

// The note templates switched on in this tab, kept the same way.
const TAB_NOTES = "veriqall.studio.notes";

function readTabNotes(): string[] | null {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(TAB_NOTES) ?? "null",
    );
    return Array.isArray(value) && value.every((v) => typeof v === "string")
      ? value
      : null;
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
  const tl = useTranslations("languages");
  const t = useTranslations("calls");
  const td = useTranslations("domain");
  const tc = useTranslations("common");
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [productId, setProductId] = useState("");
  const [starred, setStarred] = useState<string | null>(null);
  const [points, setPoints] = useState<RequiredPoint[]>([]);
  const [customer, setCustomer] = useState<Pick<
    Customer,
    "id" | "name"
  > | null>(null);
  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [saleId, setSaleId] = useState("");
  const [title, setTitle] = useState("");
  const [languages, setLanguages] = useState<CallLanguageChoice>(() =>
    typeof window === "undefined"
      ? { outputLocale: null, spokenLanguages: null }
      : readLanguages(),
  );
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
  const noteTemplates = useNoteTemplates(
    me?.modules?.includes("reports") ?? false,
  );
  const [notes, setNotes] = useState<string[] | null>(null);
  // Before anything is chosen in this tab: the call centre's default note template.
  const chosenNotes =
    notes ??
    (noteTemplates
      ? (readTabNotes() ??
        noteTemplates.filter((t) => t.isDefault).map((t) => t.id))
      : []
    ).filter((id) => noteTemplates?.some((t) => t.id === id));

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
        const published = rows.filter(
          (p) => p.publishedVersion !== null && !p.archivedAt,
        );
        setProducts(published);
        setStarred(studio.productId);
        const tab = readTabProduct();
        const start =
          [tab, studio.productId].find(
            (id) => id && published.some((p) => p.id === id),
          ) ?? (published.length === 1 ? published[0]!.id : "");
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
      .then(
        (p) =>
          !cancelled &&
          setPoints(
            p.versions.find((v) => v.status === "published")?.requiredPoints ??
              [],
          ),
      )
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
    const timer = setInterval(
      () => setElapsed(recorder.current?.elapsedMs ?? 0),
      500,
    );
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => {
      clearInterval(timer);
      window.removeEventListener("beforeunload", warn);
    };
  }, [recording]);

  if (!me) return null;
  if (!me.permissions.includes("calls.upload"))
    return <NoAccess text={t("studio.noAccess")} />;

  // A recorder error in the page's language (the API's own messages are shown as they are).
  const recorderText = (e: RecorderError) => {
    switch (e.key) {
      case "incompleteUpload":
        return t("recorder.incompleteUpload", {
          detail: e.detail ?? t("recorder.signedOut"),
        });
      default:
        return t(`recorder.${e.key}`);
    }
  };
  const errorText = (e: unknown) =>
    e instanceof RecorderError ? recorderText(e) : (e as Error).message;

  const activeId =
    state.step === "recording" || state.step === "stopping"
      ? state.callId
      : doneId;
  const analysed = Boolean(call?.analyses.length);
  const busy = state.step !== "idle";

  const links = () => ({
    title: title.trim() || null,
    customerId: customer?.id ?? null,
    saleId: saleId || null,
    productId: saleId ? null : productId || null,
    noteTemplateIds: chosenNotes,
    outputLocale: languages.outputLocale,
    spokenLanguages: languages.spokenLanguages,
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
      await orgFetch(`/calls/${activeId}`, {
        method: "PATCH",
        body: { noteTemplateIds: ids },
      }).catch((e: Error) => setError(e.message));
    }
  }

  async function chooseLanguages(next: CallLanguageChoice) {
    setError(null);
    setLanguages(next);
    writeLanguages(next);
    // Until the notes are written, a call already started follows the choice too.
    if (activeId && !call?.reports.length) {
      await orgFetch(`/calls/${activeId}`, {
        method: "PATCH",
        body: next,
      }).catch((e: Error) => setError(e.message));
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
    const mime = recordingMime(
      (t) =>
        typeof MediaRecorder !== "undefined" &&
        MediaRecorder.isTypeSupported(t),
    );
    let rec: CallRecorder;
    try {
      rec = await CallRecorder.open(capture, mime, {
        onLiveText: (final, partial) => setLiveText({ final, partial }),
        onRealtimeLost: () => {
          setNotice(t("studio.realtimeLost"));
          setState((s) => (s.step === "recording" ? { ...s, live: false } : s));
        },
        onUploads: setUploads,
        onUploadFatal: (message) =>
          setError(
            t("studio.uploadFatal", {
              message: message ?? t("recorder.signedOut"),
            }),
          ),
        onTabEnded: () => {
          setTabShared(false);
          setNotice(t("studio.tabEnded"));
        },
      });
    } catch (e) {
      setError(
        e instanceof RecorderError ? recorderText(e) : t("studio.startFailed"),
      );
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
      setError(t("studio.stopFailed", { message: errorText(e) }));
      setDoneId(callId);
    }
    setState({ step: "idle" });
  }

  async function upload(file: File) {
    if (!file.type.startsWith("audio/")) {
      setError(t("studio.chooseAudio"));
      return;
    }
    if (file.size > MAX_CHUNK_BYTES) {
      setError(t("studio.tooLarge"));
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
      setError(errorText(e));
    }
    setState({ step: "idle" });
  }

  const lampPoints = call?.templateVersionId ? call.requiredPoints : points;
  const lampState = recording
    ? "recording"
    : !call
      ? "before"
      : waiting
        ? "checking"
        : "off";
  const statusText = !call
    ? undefined
    : call.status === "failed"
      ? (call.error ?? t("studio.processingFailed"))
      : call.status === "processing" || call.status === "recording"
        ? t("studio.statusUpdating", {
            status: td(`callStatus.${call.status}`),
          })
        : undefined;

  return (
    <section className="flex flex-col gap-6">
      <div>
        <Link
          href="/samtaler"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-brand"
        >
          {t("back")}
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
          {t("studio.title")}
        </h1>
        <p className="mt-2 text-muted">{t("studio.intro")}</p>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 sm:p-6">
        <div className="flex min-w-0 items-end gap-2">
          <div className="min-w-0 flex-1 sm:max-w-md">
            <Field label={t("studio.template")}>
              <select
                className={`${inputClass} w-full`}
                value={sale ? sale.productId : productId}
                disabled={Boolean(sale) || analysed}
                onChange={(e) => void chooseProduct(e.target.value)}
              >
                <option value="">
                  {products ? t("studio.noTemplate") : tc("loading")}
                </option>
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
              title={
                starred === productId ? t("studio.unstar") : t("studio.star")
              }
            >
              <span aria-hidden="true">
                {starred === productId ? "★" : "☆"}
              </span>
              <span className="sr-only">
                {starred === productId ? t("studio.unstar") : t("studio.star")}
              </span>
            </button>
          )}
        </div>
        {me.modules?.includes("reports") && (
          <NoteTemplatePicker
            templates={noteTemplates}
            chosen={chosenNotes}
            onChange={(ids) => void chooseNotes(ids)}
          />
        )}
        {!recording && (
          <fieldset className="flex min-w-0 flex-wrap gap-x-6 gap-y-2">
            <legend className="mb-1 text-sm font-semibold">
              {t("studio.where")}
            </legend>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="capture"
                checked={capture === "microphone"}
                onChange={() => setCapture("microphone")}
              />
              {t("studio.microphone")}
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="capture"
                disabled={!tabSupported}
                checked={capture === "tab"}
                onChange={() => setCapture("tab")}
              />
              {t("studio.tab")}
            </label>
          </fieldset>
        )}
        {!recording && capture === "tab" && (
          <ol className="list-decimal space-y-1 rounded-lg bg-bg p-3 pl-8 text-sm">
            {tabShared ? (
              <li>{t("studio.tabShared")}</li>
            ) : (
              <>
                <li>{t("studio.tabStep1")}</li>
                <li>{t("studio.tabStep2")}</li>
                <li>{t("studio.tabStep3")}</li>
                <li>{t("studio.tabStep4")}</li>
              </>
            )}
          </ol>
        )}
        <div
          className={`flex flex-wrap items-center gap-3 ${
            // While recording on a phone, Stopp stays in reach at the bottom of the screen.
            recording
              ? "sticky bottom-0 z-10 -mx-4 border-t border-line bg-surface px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:p-0"
              : ""
          }`}
        >
          {recording ? (
            <button
              type="button"
              className={primaryButton}
              disabled={state.step === "stopping"}
              onClick={stop}
            >
              {state.step === "stopping"
                ? t("studio.stopping")
                : t("studio.stop")}
            </button>
          ) : (
            <button
              type="button"
              className={primaryButton}
              disabled={busy}
              onClick={start}
            >
              {state.step === "starting"
                ? t("studio.starting")
                : t("studio.start")}
            </button>
          )}
          {recording ? (
            <span className="text-2xl font-bold" aria-live="off">
              {formatDuration(elapsed)}
            </span>
          ) : (
            <label className={`${secondaryButton} cursor-pointer`}>
              {state.step === "uploading"
                ? t("studio.uploading")
                : t("studio.upload")}
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

        {recording && (
          <p className="text-sm text-muted" role="status">
            {capture === "tab"
              ? tabShared
                ? t("studio.captureTabMic")
                : t("studio.captureMicOnly")
              : t("studio.captureMic")}{" "}
            {uploads.pending > 0
              ? t("studio.uploadsPending", {
                  uploaded: uploads.uploaded,
                  pending: uploads.pending,
                })
              : t("studio.uploads", { uploaded: uploads.uploaded })}
            {uploads.failing && ` ${t("studio.uploadsFailing")}`}
          </p>
        )}
        {notice && (
          <p className="rounded-lg border border-line p-3">{notice}</p>
        )}
        <ErrorMessage message={error} />

        {!activeId && (
          <details className="rounded-lg border border-line p-3">
            <summary className="min-h-11 cursor-pointer content-center font-semibold">
              {customer
                ? t("studio.detailsCustomer", { customer: customer.name })
                : t("studio.details")}
            </summary>
            <div className="mt-3 flex flex-col gap-4">
              <CustomerPicker
                value={customer}
                onChange={(c) => {
                  setCustomer(c);
                  setSaleId("");
                  setSales([]);
                }}
                hint={t("studio.customerHint")}
              />
              {customer && sales.length > 0 && (
                <Field label={t("studio.sale")} hint={t("studio.saleHint")}>
                  <select
                    className={`${inputClass} sm:max-w-md`}
                    value={saleId}
                    onChange={(e) => setSaleId(e.target.value)}
                  >
                    <option value="">{t("studio.noSale")}</option>
                    {sales.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.productName},{" "}
                        {new Date(s.soldAt).toLocaleDateString(formatTagNow())}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label={t("studio.titleLabel")} hint={t("studio.optional")}>
                <input
                  maxLength={200}
                  className={`${inputClass} sm:max-w-md`}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
            </div>
          </details>
        )}
        {(!activeId || (call && !call.reports.length)) && (
          <details className="rounded-lg border border-line p-3">
            <summary className="min-h-11 cursor-pointer content-center font-semibold">
              {tl("title")}
            </summary>
            <div className="mt-3">
              <CallLanguages
                value={languages}
                defaults={{
                  outputLocale: me.contentLocale ?? "nb",
                  spokenLanguages: me.transcriptionLanguages?.length
                    ? me.transcriptionLanguages
                    : ["no"],
                }}
                onChange={chooseLanguages}
              />
            </div>
          </details>
        )}
        {doneId && !busy && call && (
          <div className="flex flex-col gap-1">
            <CallReference reference={call.reference} />
            <p className="text-sm text-muted">{t("studio.referenceHint")}</p>
          </div>
        )}
        {doneId && !busy && (
          <div className="flex flex-wrap gap-2">
            <Link href={`/samtaler/${doneId}`} className={secondaryButton}>
              {t("studio.openCall")}
            </Link>
            <button
              type="button"
              className={secondaryButton}
              onClick={() => reset(true)}
            >
              {t("studio.newCall")}
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card title={t("studio.lamps")}>
            <WarningLamps
              points={lampPoints}
              analysis={call?.analyses[0]}
              state={lampState}
            />
          </Card>
          <TranscriptPanel
            segments={call?.segments ?? []}
            live={
              recording || (!call && liveText.final)
                ? { ...liveText, on: state.step === "recording" && state.live }
                : null
            }
            status={
              statusText ?? (call ? undefined : t("studio.transcriptEmpty"))
            }
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
                ? t("studio.infoHintRegenerate")
                : undefined
            }
          />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          {call ? (
            <NotesPanel call={call} onChanged={load} chosen={chosenNotes} />
          ) : (
            <Card title={t("studio.notes")}>
              <p className="text-muted">{t("studio.notesBefore")}</p>
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}
