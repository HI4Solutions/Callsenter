"use client";

import { isLocale, MAX_CHUNK_BYTES } from "@veriqall/shared";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { useWorkMe } from "@/components/work/work-shell";
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
  listMicrophones,
  type Microphone,
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
  | { step: "pausing"; callId: string; live: boolean }
  | { step: "paused"; callId: string; live: boolean }
  | { step: "resuming"; callId: string; live: boolean }
  | { step: "stopping"; callId: string }
  | { step: "discarding"; callId: string }
  | { step: "uploading" };

// What a session tells the tab bar about itself.
export type SessionStatus = {
  state: "idle" | "recording" | "paused" | "busy" | "done";
  elapsedMs: number;
};

// How the studio reaches each session: to pause one when another starts recording.
export type SessionHandle = { pauseIfRecording: () => Promise<boolean> };

// The microphone chosen in this browser, kept until changed.
const STUDIO_MICROPHONE = "veriqall.studio.microphone";

function readMicrophone(): string | null {
  try {
    return localStorage.getItem(STUDIO_MICROPHONE);
  } catch {
    return null;
  }
}

function writeMicrophone(id: string | null) {
  try {
    if (id) localStorage.setItem(STUDIO_MICROPHONE, id);
    else localStorage.removeItem(STUDIO_MICROPHONE);
  } catch {
    // Not remembered; the choice still applies on this page.
  }
}

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

// One call in Salgsstudio (docs/plan.md, section 18): record the call, see the transcript and the
// warning lamps for the product template, add information that was not said, and get the note.
// The transcript is made from the recording and cannot be changed; the seller may adjust the
// note. The call can be paused (and goes on later where it stopped) or discarded. Each tab in the
// studio is one session; sessions stay mounted while another tab is shown.
export function StudioSession({
  tabId,
  onStatus,
  register,
  claimMicrophone,
}: {
  tabId: string;
  onStatus: (tabId: string, status: SessionStatus) => void;
  register: (tabId: string, handle: SessionHandle | null) => void;
  // Pauses any other session that is recording, before this one starts or goes on.
  claimMicrophone: (tabId: string) => Promise<void>;
}) {
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
  const [microphones, setMicrophones] = useState<Microphone[] | null>(null);
  const [microphoneId, setMicrophoneId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readMicrophone(),
  );
  const [level, setLevel] = useState(0);
  const [silent, setSilent] = useState(false);
  const [noSpeech, setNoSpeech] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
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

  // Leaving the page (or closing the tab) stops the microphone; the uploaded part can be finished
  // from the call page.
  useEffect(() => () => recorder.current?.abort(), []);

  // The microphones on this computer, kept up to date when one is plugged in or out.
  const refreshMicrophones = useCallback(() => {
    void listMicrophones().then(setMicrophones);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void listMicrophones().then((list) => !cancelled && setMicrophones(list));
    const devices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    devices?.addEventListener?.("devicechange", refreshMicrophones);
    return () => {
      cancelled = true;
      devices?.removeEventListener?.("devicechange", refreshMicrophones);
    };
  }, [refreshMicrophones]);

  // Another tab started recording: this one pauses first.
  const pauseRef = useRef<() => Promise<void>>(async () => undefined);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
    pauseRef.current = pause;
  });
  useEffect(() => {
    register(tabId, {
      pauseIfRecording: async () => {
        if (stateRef.current.step !== "recording") return false;
        await pauseRef.current();
        return true;
      },
    });
    return () => register(tabId, null);
  }, [register, tabId]);

  const recording =
    state.step === "recording" ||
    state.step === "pausing" ||
    state.step === "paused" ||
    state.step === "resuming" ||
    state.step === "stopping" ||
    state.step === "discarding";
  const paused = state.step === "paused" || state.step === "resuming";
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

  const sessionState: SessionStatus["state"] =
    state.step === "recording"
      ? "recording"
      : state.step === "paused"
        ? "paused"
        : state.step === "idle"
          ? doneId
            ? "done"
            : "idle"
          : "busy";
  useEffect(() => {
    onStatus(tabId, { state: sessionState, elapsedMs: elapsed });
  }, [onStatus, tabId, sessionState, elapsed]);

  if (!me) return null;

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

  const activeId = "callId" in state ? state.callId : doneId;
  const analysed = Boolean(call?.analyses.length);
  const busy = state.step !== "idle";

  const links = () => ({
    title: title.trim() || null,
    customerId: customer?.id ?? null,
    saleId: saleId || null,
    productId: saleId ? null : productId || null,
    noteTemplateIds: chosenNotes,
    // A locked call centre writes every note in its own language.
    outputLocale: me.contentLocaleLocked ? null : languages.outputLocale,
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
    setSilent(false);
    setNoSpeech(false);
    setLevel(0);
    setConfirmDiscard(false);
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
      // A locked call centre decides the notes language; only the spoken languages are sent.
      const body = me?.contentLocaleLocked ? { spokenLanguages: next.spokenLanguages } : next;
      await orgFetch(`/calls/${activeId}`, {
        method: "PATCH",
        body,
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
    await claimMicrophone(tabId);
    const mime = recordingMime(
      (t) =>
        typeof MediaRecorder !== "undefined" &&
        MediaRecorder.isTypeSupported(t),
    );
    let rec: CallRecorder;
    try {
      rec = await CallRecorder.open(
        capture,
        mime,
        {
        onLiveText: (final, partial) => setLiveText({ final, partial }),
        onRealtimeLost: (reason) => {
          if (reason === "lost") setNotice(t("studio.realtimeLost"));
          setState((s) => ("live" in s ? { ...s, live: false } : s));
        },
        onLevel: setLevel,
        onSilence: setSilent,
        onNoSpeech: setNoSpeech,
        onMicrophoneLost: () => {
          setSilent(true);
          setNotice(t("studio.microphoneLost"));
          void refreshMicrophones();
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
        },
        microphoneId,
      );
    } catch (e) {
      setError(
        e instanceof RecorderError ? recorderText(e) : t("studio.startFailed"),
      );
      setState({ step: "idle" });
      return;
    }
    setTabShared(tabShareActive());
    // Microphone access is granted now, so the list can show their names.
    void refreshMicrophones();
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
    if ((state.step !== "recording" && state.step !== "paused") || !recorder.current) return;
    const callId = state.callId;
    setState({ step: "stopping", callId });
    try {
      await recorder.current.stop();
      setDoneId(callId);
    } catch (e) {
      setError(t("studio.stopFailed", { message: errorText(e) }));
      setDoneId(callId);
    }
    recorder.current = null;
    setLevel(0);
    setSilent(false);
    setState({ step: "idle" });
  }

  // Pauses the recording and lets go of the microphone; "Fortsett" goes on where it stopped.
  async function pause() {
    const s = stateRef.current;
    if (s.step !== "recording" || !recorder.current) return;
    setState({ ...s, step: "pausing" });
    await recorder.current.pause();
    setElapsed(recorder.current.elapsedMs);
    setLevel(0);
    setSilent(false);
    setState({ ...s, step: "paused" });
  }

  async function resume() {
    if (state.step !== "paused" || !recorder.current) return;
    const s = state;
    setState({ ...s, step: "resuming" });
    setError(null);
    await claimMicrophone(tabId);
    try {
      await recorder.current.resume();
      setState({ ...s, step: "recording" });
    } catch (e) {
      setError(errorText(e));
      setState({ ...s, step: "paused" });
    }
  }

  // "Forkast": the call is dropped with its audio and text, and is not analysed.
  async function discard() {
    if ((state.step !== "recording" && state.step !== "paused") || !recorder.current) return;
    const callId = state.callId;
    setConfirmDiscard(false);
    setState({ step: "discarding", callId });
    try {
      await recorder.current.discard();
    } catch (e) {
      setError(t("studio.discardFailed", { message: errorText(e) }));
      recorder.current = null;
      setState({ step: "idle" });
      return;
    }
    recorder.current = null;
    reset(true);
    setNotice(t("studio.discarded"));
    setState({ step: "idle" });
  }

  async function chooseMicrophone(id: string) {
    const next = id || null;
    setMicrophoneId(next);
    writeMicrophone(next);
    setError(null);
    if (recorder.current && state.step === "recording") {
      try {
        await recorder.current.switchMicrophone(next);
        setNotice(null);
      } catch (e) {
        setError(errorText(e));
      }
    }
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
    <div className="flex flex-col gap-6">

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
                name={`capture-${tabId}`}
                checked={capture === "microphone"}
                onChange={() => setCapture("microphone")}
              />
              {t("studio.microphone")}
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name={`capture-${tabId}`}
                disabled={!tabSupported}
                checked={capture === "tab"}
                onChange={() => setCapture("tab")}
              />
              {t("studio.tab")}
            </label>
          </fieldset>
        )}
        <MicrophonePicker
          microphones={microphones}
          value={microphoneId}
          disabled={state.step !== "idle" && state.step !== "recording"}
          onChange={(id) => void chooseMicrophone(id)}
        />
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
            // While recording on a phone, the buttons stay in reach at the bottom of the screen.
            recording
              ? "sticky bottom-0 z-10 -mx-4 border-t border-line bg-surface px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:p-0"
              : ""
          }`}
        >
          {recording ? (
            <>
              <button
                type="button"
                className={primaryButton}
                disabled={state.step !== "recording" && state.step !== "paused"}
                onClick={stop}
              >
                {state.step === "stopping"
                  ? t("studio.stopping")
                  : t("studio.stop")}
              </button>
              {paused ? (
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={state.step !== "paused"}
                  onClick={() => void resume()}
                >
                  {state.step === "resuming"
                    ? t("studio.resuming")
                    : t("studio.resume")}
                </button>
              ) : (
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={state.step !== "recording"}
                  onClick={() => void pause()}
                >
                  {state.step === "pausing"
                    ? t("studio.pausing")
                    : t("studio.pause")}
                </button>
              )}
              <button
                type="button"
                className={secondaryButton}
                disabled={state.step !== "recording" && state.step !== "paused"}
                aria-expanded={confirmDiscard}
                onClick={() => setConfirmDiscard((v) => !v)}
              >
                {state.step === "discarding"
                  ? t("studio.discarding")
                  : t("studio.discard")}
              </button>
              <span className="flex items-center gap-2">
                <span className="text-2xl font-bold" aria-live="off">
                  {formatDuration(elapsed)}
                </span>
                {paused ? (
                  <span className="rounded-full border border-line px-2 py-0.5 text-sm font-semibold">
                    {t("studio.pausedBadge")}
                  </span>
                ) : (
                  <LevelMeter level={level} label={t("studio.level")} />
                )}
              </span>
            </>
          ) : (
            <>
              <button
                type="button"
                className={primaryButton}
                disabled={busy || microphones?.length === 0}
                onClick={start}
              >
                {state.step === "starting"
                  ? t("studio.starting")
                  : t("studio.start")}
              </button>
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
            </>
          )}
        </div>

        {confirmDiscard && (state.step === "recording" || state.step === "paused") && (
          <div role="alertdialog" aria-labelledby={`discard-${tabId}`} className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-3">
            <p id={`discard-${tabId}`}>{t("studio.discardConfirm")}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primaryButton} onClick={() => void discard()}>
                {t("studio.discardYes")}
              </button>
              <button type="button" className={secondaryButton} onClick={() => setConfirmDiscard(false)}>
                {t("studio.discardNo")}
              </button>
            </div>
          </div>
        )}
        {state.step === "recording" && (silent || noSpeech) && (
          <p role="alert" className="rounded-lg border-2 border-brand p-3 font-medium">
            {silent ? t("studio.silent") : t("studio.noSpeech")}
          </p>
        )}
        {paused && <p className="text-sm text-muted">{t("studio.pausedHint")}</p>}

        {recording && !paused && (
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
                  outputLocaleLocked: me.contentLocaleLocked ?? false,
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
    </div>
  );
}

// The microphone to record from. Says clearly when there is none; the names show once the
// browser has been allowed to use the microphone.
function MicrophonePicker({
  microphones,
  value,
  disabled,
  onChange,
}: {
  microphones: Microphone[] | null;
  value: string | null;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const t = useTranslations("calls.studio");
  if (microphones === null) return null;
  if (microphones.length === 0) {
    return (
      <p role="alert" className="rounded-lg border-2 border-brand p-3 font-medium">
        {t("noMicrophones")}
      </p>
    );
  }
  const named = microphones.some((m) => m.label);
  const current = value && microphones.some((m) => m.id === value) ? value : "";
  return (
    <Field label={t("microphoneLabel")} hint={named ? undefined : t("microphoneNamesHint")}>
      <select
        className={`${inputClass} w-full sm:max-w-md`}
        value={current}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t("microphoneDefault")}</option>
        {microphones
          .filter((m) => m.id && m.id !== "default" && m.id !== "communications")
          .map((m, i) => (
            <option key={m.id} value={m.id}>
              {m.label || t("microphoneNumber", { n: i + 1 })}
            </option>
          ))}
      </select>
    </Field>
  );
}

// How loud the microphone is right now: a short bar in the brand colour.
function LevelMeter({ level, label }: { level: number; label: string }) {
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
      className="relative h-2 w-16 overflow-hidden rounded-full bg-line"
    >
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-brand transition-[width] duration-200 motion-reduce:transition-none"
        style={{ width: `${Math.round(Math.min(1, level) * 100)}%` }}
      />
    </span>
  );
}
