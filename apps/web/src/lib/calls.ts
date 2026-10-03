// Calls (apps/api/src/org/calls.ts): types and formatting for /samtaler.
import type { Locale } from "@veriqall/shared";
import type { FlagLevel } from "@/components/flag";

export type CallStatus = "recording" | "processing" | "transcribed" | "analyzed" | "failed";
export type Level = "green" | "yellow" | "red";

export interface CallSummary {
  id: string;
  // VQ-XXXX-XXXX: copied into the call centre's own sales system, and searchable here.
  reference: string;
  status: CallStatus;
  source: "microphone" | "tab" | "upload";
  title: string | null;
  startedAt: string;
  durationMs: number | null;
  expiresAt: string;
  error: string | null;
  userId: string;
  userName: string | null;
  teamName: string | null;
  customerId: string | null;
  customerName: string | null;
  saleId: string | null;
  productId: string | null;
  productName: string | null;
  templateVersion: number | null;
  flag: Level | null;
  reviewedAt: string | null;
  match?: string | null;
}

export interface Finding {
  kind: "required_point" | "forbidden_phrase" | "price_terms" | "other";
  pointId: string;
  label: string;
  level: Level;
  quote: string | null;
  startMs: number | null;
  comment: string;
}

export interface CallDetail extends CallSummary {
  note: string | null;
  transcriptionMode: "realtime" | "chunked";
  hasAudio: boolean;
  // The worker is processing the call right now.
  working: boolean;
  templateVersionId: string | null;
  // The mandatory points of the template version the call is checked against.
  requiredPoints: RequiredPoint[];
  // The signed-in member made the call (only they adjust its notes).
  isOwn: boolean;
  // The note templates chosen in the studio (one note each after the call).
  noteTemplateIds: string[];
  // The languages chosen for the call (null follows the call centre's, given beside them), and
  // the language heard in the transcript (docs/plan.md, section 19).
  outputLocale: Locale | null;
  spokenLanguages: string[] | null;
  defaultOutputLocale: Locale;
  defaultSpokenLanguages: string[];
  transcriptLanguage: Locale | null;
  segments: { seq: number; speaker: string | null; startMs: number; endMs: number; text: string }[];
  analyses: {
    id: string;
    flag: Level;
    summary: string;
    findings: Finding[];
    model: string;
    // The language the AI control was written in (null before languages came).
    locale: Locale | null;
    createdAt: string;
    reviewedAt: string | null;
    reviewedByName: string | null;
    reviewNote: string | null;
  }[];
  reports: Note[];
}

export interface RequiredPoint {
  id: string;
  text: string;
}

// A note (report) from the call: written by AI, possibly adjusted by the seller.
export interface Note {
  id: string;
  templateName: string;
  status: "pending" | "done" | "failed";
  // The language the note is written in (null before languages came, or while pending for the call's).
  locale: Locale | null;
  error: string | null;
  // The seller's latest version, or the AI text.
  content: string | null;
  aiContent: string | null;
  editedAt: string | null;
  editedByName: string | null;
  edits: number;
  requestedByName: string | null;
  model: string | null;
  createdAt: string;
}

export interface CallStatusCheck {
  status: CallStatus;
  working: boolean;
  analyses: number;
  reports: number;
  pendingReports: number;
}

export interface RealtimeConfig {
  apiKey: string;
  url: string;
  model: string;
  languageHints: string[];
  terms: string[];
}

export interface CreatedCall {
  id: string;
  mode: "realtime" | "chunked";
  expiresAt: string;
  realtime: RealtimeConfig | null;
}

export const CALL_STATUS: Record<CallStatus, string> = {
  recording: "Tar opp",
  processing: "Transkriberes",
  transcribed: "Transkribert",
  analyzed: "Ferdig",
  failed: "Feilet",
};

export const SOURCE: Record<CallSummary["source"], string> = {
  microphone: "Mikrofon",
  tab: "Fanelyd og mikrofon",
  upload: "Opplastet fil",
};

// AI flags use the reserved colors (CLAUDE.md, "Farger") with their names.
export const FLAG_LEVEL: Record<Level, FlagLevel> = { green: "approved", yellow: "deviation", red: "violation" };

export const FINDING_KIND: Record<Finding["kind"], string> = {
  required_point: "Obligatorisk punkt",
  forbidden_phrase: "Forbudt formulering",
  price_terms: "Pris og vilkår",
  other: "Annet",
};

// 65000 → "1:05", 3723000 → "1:02:03".
export function formatDuration(ms: number | null): string {
  if (ms === null) return "–";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function canSeeCalls(me: { permissions: string[]; modules?: string[] }): boolean {
  return (
    (me.modules ?? []).includes("transcription") &&
    ["calls.read.own", "calls.read.team", "calls.read.all", "calls.upload"].some((p) => me.permissions.includes(p))
  );
}

// The audio type MediaRecorder should use: Opus in WebM where supported (Chrome, Edge, Firefox),
// otherwise what the browser offers (Safari records MP4/AAC).
export function recordingMime(isSupported: (type: string) => boolean): string {
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (isSupported(type)) return type;
  }
  return "audio/webm";
}
