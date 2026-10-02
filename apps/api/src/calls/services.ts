// What the API needs for calls: the audio bucket, Soniox for realtime keys, and a way to start
// the worker. Built once per Lambda container in api.ts; replaced by fakes in tests.
import type { Soniox } from "./soniox.ts";
import type { AudioStore } from "./store.ts";

export interface CallServices {
  store: AudioStore;
  // Null when no Soniox key is configured: then only chunked mode works, and the worker reports
  // that transcription is not set up.
  soniox: Soniox | null;
  // Starts the worker for a call (asynchronously; returns at once).
  startWorker(callId: string): Promise<void>;
}
