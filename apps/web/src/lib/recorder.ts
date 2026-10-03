// Records a call in the browser (docs/plan.md, section 13), the way MedSide records
// consultations: the microphone, optionally mixed with the audio of a browser tab where the call
// runs (web telephony, Teams, Whereby and so on). The recording is uploaded in chunks while it
// runs, so nothing is lost if the browser stops. For text while the call goes on:
// - in pieces (the default, as in MedSide): every 15 seconds a separate, complete audio file is
//   made and uploaded, and the server transcribes it with Soniox's async model. The pieces
//   become the call's transcript, so it is ready when the recording stops;
// - realtime: the same audio is streamed to Soniox. That text is a help for the seller only; the
//   stored recording is transcribed on the server afterwards. If realtime drops, pieces take over
//   for the live text.
import { AdminError, apiFetch } from "./api";
import type { CreatedCall } from "./calls";

export type Capture = "microphone" | "tab";

export class RecorderError extends Error {}

// How often a chunk is uploaded. Short enough that little is lost, long enough to keep the
// number of uploads down (a 2-hour call is 480 chunks).
const CHUNK_MS = 15_000;

// The tab share is kept between recordings on the same page, so the next recording does not ask
// again. It ends when the user stops sharing or closes the tab.
let sharedTab: MediaStream | null = null;

export function tabShareActive(): boolean {
  return Boolean(sharedTab?.getAudioTracks().some((t) => t.readyState === "live"));
}

export function tabAudioSupported(): boolean {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) return false;
  // Tab audio works in Chromium browsers on desktop only.
  const ua = navigator.userAgent;
  return /Chrome|Edg\//.test(ua) && !/Mobile|Android|iPhone|iPad/.test(ua);
}

async function openTab(): Promise<MediaStream> {
  if (tabShareActive()) return sharedTab!;
  let display: MediaStream;
  try {
    // Chrome only shares audio together with video; the video track is stopped at once, so no
    // picture of the screen is ever recorded.
    display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch {
    throw new RecorderError("Delingen ble avbrutt. Velg fanen der samtalen går, og prøv igjen.");
  }
  display.getVideoTracks().forEach((t) => t.stop());
  if (!display.getAudioTracks().length) {
    display.getTracks().forEach((t) => t.stop());
    throw new RecorderError("Ingen lyd fra fanen. Huk av for «Del fanelyd» når du velger fanen, og prøv igjen.");
  }
  sharedTab = display;
  display.getAudioTracks()[0]!.addEventListener("ended", () => {
    if (sharedTab === display) sharedTab = null;
  });
  return display;
}

export function stopTabShare() {
  sharedTab?.getTracks().forEach((t) => t.stop());
  sharedTab = null;
}

export interface RecorderCallbacks {
  onLiveText?: (finalText: string, partial: string) => void;
  // Live text stopped (no key, lost connection or an error at Soniox). Recording goes on.
  onRealtimeLost?: () => void;
  onUploads?: (state: { uploaded: number; pending: number; failing: boolean }) => void;
  // The shared tab was closed or sharing stopped while recording.
  onTabEnded?: () => void;
  // Uploading cannot continue (signed out, or the call was finished elsewhere).
  onUploadFatal?: (message: string) => void;
}

interface SonioxMessage {
  tokens?: { text: string; is_final?: boolean }[];
  finished?: boolean;
  error_code?: number;
  error_message?: string;
}

export class CallRecorder {
  readonly capture: Capture;
  readonly mime: string;
  #mic: MediaStream;
  #context: AudioContext | null = null;
  #stream: MediaStream;
  #storage: MediaRecorder | null = null;
  #live: MediaRecorder | null = null;
  #socket: WebSocket | null = null;
  #callId = "";
  #seq = 0;
  #queue: { seq: number; blob: Blob }[] = [];
  #uploaded = 0;
  #uploading: Promise<void> = Promise.resolve();
  #failing = false;
  #fatal: string | null = null;
  #stopped = false;
  #startedAt = 0;
  #finalText = "";
  // Pieces for transcription while recording.
  #piece: MediaRecorder | null = null;
  #pieceTimer: ReturnType<typeof setInterval> | null = null;
  #pieceCount = 0;
  #pieceUploads: Promise<void> = Promise.resolve();
  #pieceTexts = new Map<number, string>();
  #piecesPending = new Set<number>();
  #pollTimer: ReturnType<typeof setInterval> | null = null;
  #polledOnce = false;
  #callbacks: RecorderCallbacks;

  private constructor(capture: Capture, mime: string, mic: MediaStream, stream: MediaStream, context: AudioContext | null, cb: RecorderCallbacks) {
    this.capture = capture;
    this.mime = mime;
    this.#mic = mic;
    this.#stream = stream;
    this.#context = context;
    this.#callbacks = cb;
  }

  // Opens the microphone, and for "tab" the shared tab, and mixes them into one track.
  static async open(capture: Capture, mime: string, callbacks: RecorderCallbacks = {}): Promise<CallRecorder> {
    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch {
      throw new RecorderError("Fikk ikke tilgang til mikrofonen. Gi nettleseren lov til å bruke mikrofonen, og prøv igjen.");
    }
    if (capture === "microphone") return new CallRecorder(capture, mime, mic, mic, null, callbacks);
    let tab: MediaStream;
    try {
      tab = await openTab();
    } catch (error) {
      mic.getTracks().forEach((t) => t.stop());
      throw error;
    }
    const context = new AudioContext();
    const destination = context.createMediaStreamDestination();
    context.createMediaStreamSource(mic).connect(destination);
    context.createMediaStreamSource(new MediaStream(tab.getAudioTracks())).connect(destination);
    const recorder = new CallRecorder(capture, mime, mic, destination.stream, context, callbacks);
    tab.getAudioTracks()[0]!.addEventListener("ended", () => callbacks.onTabEnded?.());
    return recorder;
  }

  get elapsedMs() {
    return this.#startedAt ? Date.now() - this.#startedAt : 0;
  }

  start(call: CreatedCall) {
    this.#callId = call.id;
    this.#startedAt = Date.now();
    this.#storage = new MediaRecorder(this.#stream, { mimeType: this.mime, audioBitsPerSecond: 32_000 });
    this.#storage.addEventListener("dataavailable", (e) => {
      if (e.data.size) this.#enqueue(e.data);
    });
    this.#storage.start(CHUNK_MS);
    if (call.realtime) this.#startLive(call);
    else this.#startPieces();
  }

  // A complete audio file every 15 seconds: the next one starts before the previous stops, so no
  // audio falls between them.
  #startPieces() {
    if (this.#piece || this.#stopped) return;
    const begin = () => {
      const startMs = this.elapsedMs;
      const recorder = new MediaRecorder(this.#stream, { mimeType: this.mime, audioBitsPerSecond: 32_000 });
      const parts: Blob[] = [];
      recorder.addEventListener("dataavailable", (e) => {
        if (e.data.size) parts.push(e.data);
      });
      recorder.addEventListener("stop", () => {
        const blob = new Blob(parts, { type: this.mime });
        if (blob.size) this.#enqueuePiece(this.#pieceCount++, startMs, blob);
      });
      recorder.start();
      return recorder;
    };
    this.#piece = begin();
    this.#pieceTimer = setInterval(() => {
      if (this.#stopped) return;
      const previous = this.#piece;
      this.#piece = begin();
      if (previous?.state === "recording") previous.stop();
    }, CHUNK_MS);
    this.#pollTimer = setInterval(() => void this.#pollPieces(), 3000);
  }

  #enqueuePiece(seq: number, startMs: number, blob: Blob) {
    this.#piecesPending.add(seq);
    this.#emitPieces();
    this.#pieceUploads = this.#pieceUploads.then(() => this.#uploadPiece(seq, startMs, blob));
  }

  // Uploaded and handed to the server for transcription. A piece that cannot be uploaded is left
  // out: the server then transcribes the whole recording instead.
  async #uploadPiece(seq: number, startMs: number, blob: Blob) {
    for (let attempt = 0; attempt < 6 && !this.#fatal; attempt++) {
      try {
        const { url, contentType } = await apiFetch<{ url: string; contentType: string }>(`/org/calls/${this.#callId}/pieces`, {
          method: "POST",
          body: { seq, startMs, size: blob.size },
        });
        const res = await fetch(url, { method: "PUT", body: blob, headers: { "content-type": contentType } });
        if (!res.ok) throw new Error(`upload ${res.status}`);
        await apiFetch(`/org/calls/${this.#callId}/pieces/${seq}/uploaded`, { method: "POST" });
        return;
      } catch (error) {
        if (error instanceof AdminError && error.status >= 400 && error.status < 500) break;
        await new Promise((r) => setTimeout(r, Math.min(15_000, 1000 * 2 ** attempt)));
      }
    }
    this.#piecesPending.delete(seq);
    this.#emitPieces();
  }

  // The text of the pieces transcribed so far.
  async #pollPieces() {
    if (!this.#piecesPending.size) return;
    let after = -1;
    while (this.#polledOnce && this.#pieceTexts.has(after + 1)) after++;
    try {
      const rows = await apiFetch<{ seq: number; status: string; segments: { text: string }[] | null }[]>(
        `/org/calls/${this.#callId}/pieces?after=${this.#polledOnce ? after : -1}`,
      );
      this.#polledOnce = true;
      for (const row of rows) {
        if (row.status === "done" || row.status === "failed") {
          this.#pieceTexts.set(row.seq, (row.segments ?? []).map((x) => x.text).join(" "));
          this.#piecesPending.delete(row.seq);
        }
      }
      this.#emitPieces();
    } catch {
      // Tried again at the next poll.
    }
  }

  #emitPieces() {
    const text = [...this.#pieceTexts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, t]) => t)
      .filter(Boolean)
      .join(" ");
    this.#callbacks.onLiveText?.(text, this.#piecesPending.size ? " …" : "");
  }

  #startLive(call: CreatedCall) {
    const config = call.realtime!;
    let socket: WebSocket;
    try {
      socket = new WebSocket(config.url);
    } catch {
      this.#callbacks.onRealtimeLost?.();
      return;
    }
    this.#socket = socket;
    let partial = "";
    const lost = () => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      if (this.#live?.state === "recording") this.#live.stop();
      this.#callbacks.onRealtimeLost?.();
      // Pieces take over the live text from here.
      this.#finalText = "";
      this.#startPieces();
    };
    socket.addEventListener("open", () => {
      // Stopped before the connection opened: nothing to stream.
      if (this.#socket !== socket || this.#stopped) {
        socket.close();
        return;
      }
      socket.send(
        JSON.stringify({
          api_key: config.apiKey,
          model: config.model,
          audio_format: "auto",
          language_hints: config.languageHints,
          enable_endpoint_detection: true,
          enable_speaker_diarization: true,
          ...(config.terms.length ? { context: { terms: config.terms } } : {}),
        }),
      );
      this.#live = new MediaRecorder(this.#stream, { mimeType: this.mime, audioBitsPerSecond: 32_000 });
      this.#live.addEventListener("dataavailable", (e) => {
        if (e.data.size && socket.readyState === WebSocket.OPEN) socket.send(e.data);
      });
      this.#live.start(250);
    });
    socket.addEventListener("message", (e) => {
      let message: SonioxMessage;
      try {
        message = JSON.parse(String(e.data)) as SonioxMessage;
      } catch {
        return;
      }
      if (message.error_code) return lost();
      partial = "";
      for (const token of message.tokens ?? []) {
        if (token.text === "<end>" || token.text === "<fin>") continue;
        if (token.is_final) this.#finalText += token.text;
        else partial += token.text;
      }
      this.#callbacks.onLiveText?.(this.#finalText, partial);
    });
    socket.addEventListener("error", lost);
    socket.addEventListener("close", () => {
      if (this.#storage?.state === "recording") lost();
    });
  }

  #enqueue(blob: Blob) {
    this.#queue.push({ seq: this.#seq++, blob });
    this.#report();
    this.#uploading = this.#uploading.then(() => this.#drain());
  }

  #report() {
    this.#callbacks.onUploads?.({ uploaded: this.#uploaded, pending: this.#queue.length, failing: this.#failing });
  }

  async #drain() {
    while (this.#queue.length && !this.#fatal) {
      const item = this.#queue[0]!;
      let attempt = 0;
      for (;;) {
        try {
          const { url, contentType } = await apiFetch<{ url: string; contentType: string }>(`/org/calls/${this.#callId}/chunks`, {
            method: "POST",
            body: { seq: item.seq, size: item.blob.size },
          });
          const res = await fetch(url, { method: "PUT", body: item.blob, headers: { "content-type": contentType } });
          if (!res.ok) throw new Error(`upload ${res.status}`);
          break;
        } catch (error) {
          // A refusal from the API will not change by trying again.
          if (error instanceof AdminError && error.status >= 400 && error.status < 500) {
            this.#fatal = error.status === 401 ? "Du er logget ut." : error.message;
            this.#queue = [];
            this.#report();
            this.#callbacks.onUploadFatal?.(this.#fatal);
            return;
          }
          attempt++;
          this.#failing = attempt >= 3;
          this.#report();
          // Keep trying: the chunk stays in memory until it is uploaded.
          await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** attempt)));
        }
      }
      this.#queue.shift();
      this.#uploaded++;
      this.#failing = false;
      this.#report();
    }
  }

  // Stops recording, waits for every chunk to be uploaded, and finishes the call. Returns the
  // recorded duration.
  async stop(): Promise<number> {
    const durationMs = this.elapsedMs;
    this.#stopped = true;
    const storage = this.#storage;
    if (storage && storage.state !== "inactive") {
      await new Promise<void>((resolve) => {
        storage.addEventListener("stop", () => resolve(), { once: true });
        storage.stop();
      });
    }
    if (this.#pieceTimer) clearInterval(this.#pieceTimer);
    const piece = this.#piece;
    if (piece && piece.state !== "inactive") {
      await new Promise<void>((resolve) => {
        piece.addEventListener("stop", () => resolve(), { once: true });
        piece.stop();
      });
    }
    if (this.#live?.state === "recording") this.#live.stop();
    const socket = this.#socket;
    this.#socket = null;
    if (socket?.readyState === WebSocket.OPEN) {
      // An empty frame tells Soniox the audio has ended.
      socket.send("");
      setTimeout(() => socket.close(), 2000);
    }
    this.release();
    await this.#uploading;
    if (this.#fatal) throw new RecorderError(`Opptaket kunne ikke lastes ferdig opp: ${this.#fatal}`);
    await this.#pieceUploads;
    if (this.#pollTimer) clearInterval(this.#pollTimer);
    await apiFetch(`/org/calls/${this.#callId}/complete`, { method: "POST", body: { durationMs, pieces: this.#pieceCount } });
    return durationMs;
  }

  // Leaves the page while recording: stops everything without finishing the call. What was
  // uploaded can be finished from the call page, or is finished automatically later.
  abort() {
    this.#stopped = true;
    if (this.#pieceTimer) clearInterval(this.#pieceTimer);
    if (this.#pollTimer) clearInterval(this.#pollTimer);
    if (this.#piece?.state === "recording") this.#piece.stop();
    if (this.#storage?.state === "recording") this.#storage.stop();
    if (this.#live?.state === "recording") this.#live.stop();
    this.#socket?.close();
    this.#socket = null;
    this.release();
  }

  // Frees the microphone (the tab share stays for the next recording).
  release() {
    this.#mic.getTracks().forEach((t) => t.stop());
    if (this.#context) void this.#context.close();
    this.#context = null;
  }
}

// Uploads a file as one chunk and finishes the call.
export async function uploadFile(callId: string, file: File) {
  const { url, contentType } = await apiFetch<{ url: string; contentType: string }>(`/org/calls/${callId}/chunks`, {
    method: "POST",
    body: { seq: 0, size: file.size },
  });
  const res = await fetch(url, { method: "PUT", body: file, headers: { "content-type": contentType } });
  if (!res.ok) throw new RecorderError("Opplastingen feilet. Prøv igjen.");
  await apiFetch(`/org/calls/${callId}/complete`, { method: "POST", body: {} });
}
