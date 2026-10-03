// Soniox speech-to-text in the EU (https://soniox.com/docs). The fixed API key never leaves the
// server: the browser gets a short-lived temporary key for the realtime WebSocket, and stored
// recordings are transcribed through the async API, after which the file and the transcription
// are deleted at Soniox at once.

export const SONIOX_REALTIME_URL = "wss://stt-rt.eu.soniox.com/transcribe-websocket";
export const SONIOX_REALTIME_MODEL = "stt-rt-v5";
export const SONIOX_ASYNC_MODEL = "stt-async-v5";

export interface SonioxToken {
  text: string;
  start_ms?: number;
  end_ms?: number;
  speaker?: string;
  is_final?: boolean;
  // With language identification: the language Soniox heard (its code, "no", "sv", ...).
  language?: string;
}

export interface SonioxContext {
  general?: { key: string; value: string }[];
  terms?: string[];
}

export class SonioxError extends Error {}

export class Soniox {
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #host: string;

  constructor(apiKey: string, fetchImpl: typeof fetch = fetch, host = "https://api.eu.soniox.com") {
    this.#apiKey = apiKey;
    this.#fetch = fetchImpl;
    this.#host = host.replace(/\/$/, "");
  }

  async #call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const isForm = body instanceof FormData;
    const res = await this.#fetch(`${this.#host}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        ...(body !== undefined && !isForm ? { "content-type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    if (!res.ok) {
      // The body explains the error; it never contains audio or transcript text.
      throw new SonioxError(`soniox ${method} ${path.replace(/[0-9a-f-]{20,}/g, ":id")} ${res.status} ${(await res.text()).slice(0, 300)}`);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // A key the browser may use for one realtime session. It only has to be valid when the
  // WebSocket opens; the session itself may run for hours.
  temporaryKey(clientReferenceId: string) {
    return this.#call<{ api_key: string; expires_at: string }>("POST", "/v1/auth/temporary-api-key", {
      usage_type: "transcribe_websocket",
      expires_in_seconds: 300,
      max_session_duration_seconds: 4 * 3600,
      client_reference_id: clientReferenceId,
    });
  }

  async uploadFile(bytes: Uint8Array, filename: string, mime: string): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), filename);
    const { id } = await this.#call<{ id: string }>("POST", "/v1/files", form);
    return id;
  }

  // languages: the languages expected in the call, as Soniox codes (hints, not a limit). Soniox
  // also tags each token with the language it heard, which gives the transcript its language.
  async createTranscription(fileId: string, context: SonioxContext, clientReferenceId: string, languages: string[] = ["no"]): Promise<string> {
    const { id } = await this.#call<{ id: string }>("POST", "/v1/transcriptions", {
      model: SONIOX_ASYNC_MODEL,
      file_id: fileId,
      language_hints: languages,
      enable_language_identification: true,
      enable_speaker_diarization: true,
      ...(context.terms?.length || context.general?.length ? { context } : {}),
      client_reference_id: clientReferenceId,
    });
    return id;
  }

  status(id: string) {
    return this.#call<{ status: "queued" | "processing" | "completed" | "error"; error_message?: string; audio_duration_ms?: number }>(
      "GET",
      `/v1/transcriptions/${encodeURIComponent(id)}`,
    );
  }

  transcript(id: string) {
    return this.#call<{ text: string; tokens: SonioxToken[] }>("GET", `/v1/transcriptions/${encodeURIComponent(id)}/transcript`);
  }

  async deleteTranscription(id: string) {
    await this.#call("DELETE", `/v1/transcriptions/${encodeURIComponent(id)}`);
  }

  async deleteFile(id: string) {
    await this.#call("DELETE", `/v1/files/${encodeURIComponent(id)}`);
  }
}

export interface Segment {
  speaker: string | null;
  startMs: number;
  endMs: number;
  text: string;
  // On a piece's segments: the language heard in the piece (Soniox code).
  language?: string;
}

// The language Soniox heard most (by characters), as its code; null without identification.
export function mainLanguage(tokens: { text: string; language?: string }[]): string | null {
  const count = new Map<string, number>();
  for (const t of tokens) if (t.language) count.set(t.language, (count.get(t.language) ?? 0) + t.text.length);
  let best: string | null = null;
  for (const [language, n] of count) if (best === null || n > count.get(best)!) best = language;
  return best;
}

// Joins Soniox tokens (sub-word pieces with timestamps) into segments: a new segment when the
// speaker changes, after a sentence end with a pause, or when a segment gets long.
export function toSegments(tokens: SonioxToken[]): Segment[] {
  const segments: Segment[] = [];
  let current: Segment | null = null;
  for (const token of tokens) {
    if (!token.text || token.text === "<end>" || token.text === "<fin>") continue;
    const start: number = token.start_ms ?? current?.endMs ?? 0;
    const end: number = token.end_ms ?? start;
    const speaker = token.speaker ?? null;
    const breakHere =
      !current ||
      speaker !== current.speaker ||
      (/[.!?]\s*$/.test(current.text) && start - current.endMs > 700) ||
      (current.text.length > 400 && token.text.startsWith(" "));
    if (breakHere) {
      if (current) segments.push(current);
      current = { speaker, startMs: start, endMs: end, text: token.text.trimStart() };
    } else {
      current!.text += token.text;
      current!.endMs = Math.max(current!.endMs, end);
    }
  }
  if (current) segments.push(current);
  return segments.map((s) => ({ ...s, text: s.text.trim() })).filter((s) => s.text);
}
