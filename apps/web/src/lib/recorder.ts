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
// The microphone (and the tab) go through an AudioContext into one stream that the recorders
// record. That is what lets Salgsstudio pause a call and free the microphone for another call,
// switch microphone while recording, and warn when no sound comes in.
import { AdminError, apiFetch } from "./api";
import type { CreatedCall } from "./calls";

export type Capture = "microphone" | "tab";

// What went wrong, as a key the studio translates (calls.recorder.<key>). `detail` is the API's
// message for incompleteUpload (null when the seller was signed out).
export type RecorderErrorKey =
  | "tabCancelled"
  | "noTabAudio"
  | "noMicrophone"
  | "micBlocked"
  | "incompleteUpload"
  | "uploadFailed";

export class RecorderError extends Error {
  readonly key: RecorderErrorKey;
  readonly detail: string | null;
  constructor(key: RecorderErrorKey, detail: string | null = null) {
    super(key);
    this.name = "RecorderError";
    this.key = key;
    this.detail = detail;
  }
}

// How often a chunk is uploaded. Short enough that little is lost, long enough to keep the
// number of uploads down (a 2-hour call is 480 chunks).
const CHUNK_MS = 15_000;

// The tab share is kept between recordings on the same page, so the next recording does not ask
// again. It ends when the user stops sharing or closes the tab.
let sharedTab: MediaStream | null = null;

export function tabShareActive(): boolean {
  return Boolean(
    sharedTab?.getAudioTracks().some((t) => t.readyState === "live"),
  );
}

export function tabAudioSupported(): boolean {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getDisplayMedia
  )
    return false;
  // Tab audio works in Chromium browsers on desktop only.
  const ua = navigator.userAgent;
  return /Chrome|Edg\//.test(ua) && !/Mobile|Android|iPhone|iPad/.test(ua);
}

export interface Microphone {
  id: string;
  // Empty until the browser has been allowed to use the microphone.
  label: string;
}

// The microphones the browser knows of. Their names show once microphone access is granted.
export async function listMicrophones(): Promise<Microphone[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  return devices
    .filter((d) => d.kind === "audioinput")
    .map((d) => ({ id: d.deviceId, label: d.label }));
}

// Opens a microphone: the one chosen, or the system's default if that one is gone.
async function openMicrophone(deviceId: string | null): Promise<MediaStream> {
  const audio = (id?: string): MediaTrackConstraints => ({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    ...(id ? { deviceId: { exact: id } } : {}),
  });
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: audio(deviceId && deviceId !== "default" ? deviceId : undefined) });
  } catch (error) {
    const name = (error as DOMException)?.name;
    if (name === "NotAllowedError" || name === "SecurityError") throw new RecorderError("micBlocked");
    // The chosen microphone was unplugged: the default one, if there is any.
    if (deviceId && (name === "OverconstrainedError" || name === "NotFoundError")) {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: audio() });
      } catch {
        // Falls through to "no microphone".
      }
    }
    throw new RecorderError("noMicrophone");
  }
}

async function openTab(): Promise<MediaStream> {
  if (tabShareActive()) return sharedTab!;
  let display: MediaStream;
  try {
    // Chrome only shares audio together with video; the video track is stopped at once, so no
    // picture of the screen is ever recorded.
    display = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
  } catch {
    throw new RecorderError("tabCancelled");
  }
  display.getVideoTracks().forEach((t) => t.stop());
  if (!display.getAudioTracks().length) {
    display.getTracks().forEach((t) => t.stop());
    throw new RecorderError("noTabAudio");
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
  // "paused": the call was paused; the text comes in pieces after it is resumed.
  onRealtimeLost?: (reason: "lost" | "paused") => void;
  // The microphone's level (0 to 1), a few times a second while recording.
  onLevel?: (level: number) => void;
  // No sound from the microphone for a while (true), or sound again (false).
  onSilence?: (silent: boolean) => void;
  // Pieces have been transcribed, but no words came out of them (true), or words again (false).
  onNoSpeech?: (empty: boolean) => void;
  // The microphone was unplugged or stopped by the system.
  onMicrophoneLost?: () => void;
  onUploads?: (state: {
    uploaded: number;
    pending: number;
    failing: boolean;
  }) => void;
  // The shared tab was closed or sharing stopped while recording.
  onTabEnded?: () => void;
  // Uploading cannot continue: the API's message (the call was finished elsewhere and so on), or
  // null when the seller was signed out.
  onUploadFatal?: (message: string | null) => void;
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
  #micId: string | null;
  #tab: MediaStream | null;
  #context: AudioContext;
  #destination: MediaStreamAudioDestinationNode;
  #micSource: MediaStreamAudioSourceNode | null = null;
  #tabSource: MediaStreamAudioSourceNode | null = null;
  #analyser: AnalyserNode;
  #levelTimer: ReturnType<typeof setInterval> | null = null;
  #quietSince = 0;
  #silent = false;
  #noSpeech = false;
  #paused = false;
  #pausedAt = 0;
  #pausedMs = 0;
  // Live text was ended by a pause; pieces take over when the call is resumed.
  #resumeWithPieces = false;
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
  // The upload stopped for good: the API's message, or null when signed out.
  #fatal: { message: string | null } | null = null;
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

  private constructor(
    capture: Capture,
    mime: string,
    mic: MediaStream,
    micId: string | null,
    tab: MediaStream | null,
    cb: RecorderCallbacks,
  ) {
    this.capture = capture;
    this.mime = mime;
    this.#mic = mic;
    this.#micId = micId;
    this.#tab = tab;
    this.#callbacks = cb;
    this.#context = new AudioContext();
    this.#destination = this.#context.createMediaStreamDestination();
    this.#analyser = this.#context.createAnalyser();
    this.#analyser.fftSize = 1024;
    this.#stream = this.#destination.stream;
    this.#connectMic(mic);
    if (tab) {
      this.#tabSource = this.#context.createMediaStreamSource(new MediaStream(tab.getAudioTracks()));
      this.#tabSource.connect(this.#destination);
    }
  }

  // Opens the chosen microphone, and for "tab" the shared tab, and mixes them into one stream.
  static async open(
    capture: Capture,
    mime: string,
    callbacks: RecorderCallbacks = {},
    microphoneId: string | null = null,
  ): Promise<CallRecorder> {
    const mic = await openMicrophone(microphoneId);
    let tab: MediaStream | null = null;
    if (capture === "tab") {
      try {
        tab = await openTab();
      } catch (error) {
        mic.getTracks().forEach((t) => t.stop());
        throw error;
      }
      tab.getAudioTracks()[0]!.addEventListener("ended", () => callbacks.onTabEnded?.());
    }
    const recorder = new CallRecorder(capture, mime, mic, microphoneId, tab, callbacks);
    // Opened after awaiting the browser's dialogs: make sure the audio runs.
    await recorder.#context.resume().catch(() => undefined);
    return recorder;
  }

  #connectMic(mic: MediaStream) {
    this.#micSource?.disconnect();
    this.#micSource = this.#context.createMediaStreamSource(mic);
    this.#micSource.connect(this.#destination);
    this.#micSource.connect(this.#analyser);
    mic.getAudioTracks()[0]?.addEventListener("ended", () => {
      if (this.#mic === mic && !this.#stopped && !this.#paused) this.#callbacks.onMicrophoneLost?.();
    });
  }

  get paused() {
    return this.#paused;
  }

  // The microphone in use (its device id), for the picker.
  get microphoneId(): string | null {
    return this.#mic.getAudioTracks()[0]?.getSettings().deviceId ?? this.#micId;
  }

  // Switches to another microphone while recording, without a break in the recording.
  async switchMicrophone(deviceId: string | null) {
    this.#micId = deviceId;
    if (this.#paused || this.#stopped) return;
    const next = await openMicrophone(deviceId);
    const previous = this.#mic;
    this.#mic = next;
    this.#connectMic(next);
    previous.getTracks().forEach((t) => t.stop());
    this.#quietSince = Date.now();
    this.#setSilent(false);
  }

  // Measures the microphone a few times a second. Quiet for 8 seconds in a row means no sound
  // is coming in (a muted or wrong microphone); any sound clears it again.
  #startLevels() {
    if (this.#levelTimer) return;
    const data = new Float32Array(this.#analyser.fftSize);
    this.#quietSince = Date.now();
    this.#levelTimer = setInterval(() => {
      this.#analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const rms = Math.sqrt(sum / data.length);
      this.#callbacks.onLevel?.(Math.min(1, rms * 8));
      const track = this.#mic.getAudioTracks()[0];
      const quiet = rms < 0.003 || !track || track.muted || track.readyState !== "live";
      if (!quiet) {
        this.#quietSince = Date.now();
        this.#setSilent(false);
      } else if (Date.now() - this.#quietSince > 8000) {
        this.#setSilent(true);
      }
    }, 250);
  }

  #stopLevels() {
    if (this.#levelTimer) clearInterval(this.#levelTimer);
    this.#levelTimer = null;
    this.#callbacks.onLevel?.(0);
  }

  #setSilent(silent: boolean) {
    if (silent === this.#silent) return;
    this.#silent = silent;
    this.#callbacks.onSilence?.(silent);
  }

  // Time recorded, without the pauses.
  get elapsedMs() {
    if (!this.#startedAt) return 0;
    const now = this.#paused ? this.#pausedAt : Date.now();
    return now - this.#startedAt - this.#pausedMs;
  }

  start(call: CreatedCall) {
    this.#callId = call.id;
    this.#startedAt = Date.now();
    this.#storage = new MediaRecorder(this.#stream, {
      mimeType: this.mime,
      audioBitsPerSecond: 32_000,
    });
    this.#storage.addEventListener("dataavailable", (e) => {
      if (e.data.size) this.#enqueue(e.data);
    });
    this.#storage.start(CHUNK_MS);
    if (call.realtime) this.#startLive(call);
    else this.#startPieces();
    this.#startLevels();
  }

  // Pauses the call: what was recorded is uploaded, the microphone (and tab) are let go, so
  // another call can be recorded meanwhile. The call stays open on the server until resumed or
  // stopped; one left paused for 3 hours is finished there.
  async pause() {
    if (this.#paused || this.#stopped || !this.#storage) return;
    this.#paused = true;
    this.#pausedAt = Date.now();
    this.#stopLevels();
    this.#setSilent(false);
    if (this.#storage.state === "recording") {
      this.#storage.requestData();
      this.#storage.pause();
    }
    this.#stopPieces();
    // Live text does not survive a pause; pieces take over when the call goes on.
    if (this.#socket) {
      const socket = this.#socket;
      this.#socket = null;
      if (this.#live?.state === "recording") this.#live.stop();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send("");
        setTimeout(() => socket.close(), 2000);
      } else socket.close();
      this.#resumeWithPieces = true;
      this.#callbacks.onRealtimeLost?.("paused");
    }
    this.#micSource?.disconnect();
    this.#micSource = null;
    this.#mic.getTracks().forEach((t) => t.stop());
    this.#tabSource?.disconnect();
    await this.#context.suspend().catch(() => undefined);
  }

  // Goes on where the call was paused, with the same microphone (and the tab, if still shared).
  async resume() {
    if (!this.#paused || this.#stopped || !this.#storage) return;
    const mic = await openMicrophone(this.#micId);
    this.#mic = mic;
    this.#connectMic(mic);
    if (this.#tab?.getAudioTracks().some((t) => t.readyState === "live")) {
      this.#tabSource?.connect(this.#destination);
    }
    await this.#context.resume().catch(() => undefined);
    this.#pausedMs += Date.now() - this.#pausedAt;
    this.#paused = false;
    if (this.#storage.state === "paused") this.#storage.resume();
    if (this.#resumeWithPieces || !this.#socket) {
      this.#finalText = "";
      this.#startPieces();
    }
    this.#startLevels();
  }

  // Ends the current piece and the timers; pieces start again on resume.
  #stopPieces() {
    if (this.#pieceTimer) clearInterval(this.#pieceTimer);
    this.#pieceTimer = null;
    if (this.#pollTimer) clearInterval(this.#pollTimer);
    this.#pollTimer = null;
    const piece = this.#piece;
    this.#piece = null;
    if (piece?.state === "recording") piece.stop();
  }

  // A complete audio file every 15 seconds: the next one starts before the previous stops, so no
  // audio falls between them.
  #startPieces() {
    if (this.#piece || this.#stopped || this.#paused) return;
    const begin = () => {
      const startMs = this.elapsedMs;
      const recorder = new MediaRecorder(this.#stream, {
        mimeType: this.mime,
        audioBitsPerSecond: 32_000,
      });
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
      if (this.#stopped || this.#paused) return;
      const previous = this.#piece;
      this.#piece = begin();
      if (previous?.state === "recording") previous.stop();
    }, CHUNK_MS);
    this.#pollTimer ??= setInterval(() => void this.#pollPieces(), 3000);
  }

  #enqueuePiece(seq: number, startMs: number, blob: Blob) {
    this.#piecesPending.add(seq);
    this.#emitPieces();
    this.#pieceUploads = this.#pieceUploads.then(() =>
      this.#uploadPiece(seq, startMs, blob),
    );
  }

  // Uploaded and handed to the server for transcription. A piece that cannot be uploaded is left
  // out: the server then transcribes the whole recording instead.
  async #uploadPiece(seq: number, startMs: number, blob: Blob) {
    for (let attempt = 0; attempt < 6 && !this.#fatal; attempt++) {
      try {
        const { url, contentType } = await apiFetch<{
          url: string;
          contentType: string;
        }>(`/org/calls/${this.#callId}/pieces`, {
          method: "POST",
          body: { seq, startMs, size: blob.size },
        });
        const res = await fetch(url, {
          method: "PUT",
          body: blob,
          headers: { "content-type": contentType },
        });
        if (!res.ok) throw new Error(`upload ${res.status}`);
        await apiFetch(`/org/calls/${this.#callId}/pieces/${seq}/uploaded`, {
          method: "POST",
        });
        return;
      } catch (error) {
        if (
          error instanceof AdminError &&
          error.status >= 400 &&
          error.status < 500
        )
          break;
        await new Promise((r) =>
          setTimeout(r, Math.min(15_000, 1000 * 2 ** attempt)),
        );
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
      const rows = await apiFetch<
        { seq: number; status: string; segments: { text: string }[] | null }[]
      >(
        `/org/calls/${this.#callId}/pieces?after=${this.#polledOnce ? after : -1}`,
      );
      this.#polledOnce = true;
      for (const row of rows) {
        if (row.status === "done" || row.status === "failed") {
          this.#pieceTexts.set(
            row.seq,
            (row.segments ?? []).map((x) => x.text).join(" "),
          );
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
    // Two pieces (30 seconds) transcribed without a single word: tell the seller.
    const empty = !text.trim() && this.#pieceTexts.size >= 2;
    if (empty !== this.#noSpeech) {
      this.#noSpeech = empty;
      this.#callbacks.onNoSpeech?.(empty);
    }
  }

  #startLive(call: CreatedCall) {
    const config = call.realtime!;
    let socket: WebSocket;
    try {
      socket = new WebSocket(config.url);
    } catch {
      this.#callbacks.onRealtimeLost?.("lost");
      return;
    }
    this.#socket = socket;
    let partial = "";
    const lost = () => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      if (this.#live?.state === "recording") this.#live.stop();
      this.#callbacks.onRealtimeLost?.("lost");
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
      this.#live = new MediaRecorder(this.#stream, {
        mimeType: this.mime,
        audioBitsPerSecond: 32_000,
      });
      this.#live.addEventListener("dataavailable", (e) => {
        if (e.data.size && socket.readyState === WebSocket.OPEN)
          socket.send(e.data);
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
      if (this.#storage?.state === "recording" && !this.#paused) lost();
    });
  }

  #enqueue(blob: Blob) {
    this.#queue.push({ seq: this.#seq++, blob });
    this.#report();
    this.#uploading = this.#uploading.then(() => this.#drain());
  }

  #report() {
    this.#callbacks.onUploads?.({
      uploaded: this.#uploaded,
      pending: this.#queue.length,
      failing: this.#failing,
    });
  }

  async #drain() {
    while (this.#queue.length && !this.#fatal) {
      const item = this.#queue[0]!;
      let attempt = 0;
      for (;;) {
        try {
          const { url, contentType } = await apiFetch<{
            url: string;
            contentType: string;
          }>(`/org/calls/${this.#callId}/chunks`, {
            method: "POST",
            body: { seq: item.seq, size: item.blob.size },
          });
          const res = await fetch(url, {
            method: "PUT",
            body: item.blob,
            headers: { "content-type": contentType },
          });
          if (!res.ok) throw new Error(`upload ${res.status}`);
          break;
        } catch (error) {
          // A refusal from the API will not change by trying again.
          if (
            error instanceof AdminError &&
            error.status >= 400 &&
            error.status < 500
          ) {
            this.#fatal = {
              message: error.status === 401 ? null : error.message,
            };
            this.#queue = [];
            this.#report();
            this.#callbacks.onUploadFatal?.(this.#fatal.message);
            return;
          }
          attempt++;
          this.#failing = attempt >= 3;
          this.#report();
          // Keep trying: the chunk stays in memory until it is uploaded.
          await new Promise((r) =>
            setTimeout(r, Math.min(30_000, 1000 * 2 ** attempt)),
          );
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
    this.#stopLevels();
    const storage = this.#storage;
    if (storage && storage.state !== "inactive") {
      await new Promise<void>((resolve) => {
        storage.addEventListener("stop", () => resolve(), { once: true });
        storage.stop();
      });
    }
    if (this.#pieceTimer) clearInterval(this.#pieceTimer);
    const piece = this.#piece;
    if (piece && piece.state === "recording") {
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
    if (this.#fatal)
      throw new RecorderError("incompleteUpload", this.#fatal.message);
    await this.#pieceUploads;
    if (this.#pollTimer) clearInterval(this.#pollTimer);
    await apiFetch(`/org/calls/${this.#callId}/complete`, {
      method: "POST",
      body: { durationMs, pieces: this.#pieceCount },
    });
    return durationMs;
  }

  // Leaves the page while recording: stops everything without finishing the call. What was
  // uploaded can be finished from the call page, or is finished automatically later.
  abort() {
    this.#stopped = true;
    this.#stopLevels();
    if (this.#pieceTimer) clearInterval(this.#pieceTimer);
    if (this.#pollTimer) clearInterval(this.#pollTimer);
    if (this.#piece?.state === "recording") this.#piece.stop();
    if (this.#storage && this.#storage.state !== "inactive") this.#storage.stop();
    if (this.#live?.state === "recording") this.#live.stop();
    this.#socket?.close();
    this.#socket = null;
    this.release();
  }

  // "Forkast": stops everything, uploads nothing more, and has the server drop the call with its
  // audio and text. It is not transcribed as a whole, analysed or given a note.
  async discard() {
    this.#fatal = { message: null };
    this.#queue = [];
    this.abort();
    if (!this.#callId) return;
    await apiFetch(`/org/calls/${this.#callId}/discard`, { method: "POST" });
  }

  // Frees the microphone (the tab share stays for the next recording).
  release() {
    this.#stopLevels();
    this.#mic.getTracks().forEach((t) => t.stop());
    if (this.#context.state !== "closed") void this.#context.close();
  }
}

// Uploads a file as one chunk and finishes the call.
export async function uploadFile(callId: string, file: File) {
  const { url, contentType } = await apiFetch<{
    url: string;
    contentType: string;
  }>(`/org/calls/${callId}/chunks`, {
    method: "POST",
    body: { seq: 0, size: file.size },
  });
  const res = await fetch(url, {
    method: "PUT",
    body: file,
    headers: { "content-type": contentType },
  });
  if (!res.ok) throw new RecorderError("uploadFailed");
  await apiFetch(`/org/calls/${callId}/complete`, { method: "POST", body: {} });
}
