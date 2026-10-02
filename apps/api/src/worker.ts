// Worker Lambda (docs/plan.md, section 13). Started by the API when a recording is done
// ({callId}), it transcribes and analyses that call, then tidies up: deletes calls past their
// retention, finishes abandoned recordings and frees calls a crashed run left behind.
import { type WorkerDeps, housekeeping, processCall } from "./calls/process.ts";
import { loadAi, loadSoniox } from "./calls/runtime.ts";
import { s3Store } from "./calls/store.ts";
import { iamPool } from "./db.ts";
import { required } from "./env.ts";

let deps: Promise<WorkerDeps> | undefined;

async function load(): Promise<WorkerDeps> {
  return {
    db: iamPool("veriqall_worker"),
    store: s3Store(required("AUDIO_BUCKET")),
    soniox: await loadSoniox(),
    ai: loadAi(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    // Leaves time for the AI steps within the 15-minute Lambda limit.
    sonioxTimeoutMs: 9 * 60_000,
  };
}

export async function handler(event: { callId?: unknown }) {
  deps ??= load();
  deps.catch(() => (deps = undefined));
  const d = await deps;
  if (typeof event.callId === "string" && /^[0-9a-f-]{36}$/.test(event.callId)) await processCall(d, event.callId);
  const more = await housekeeping(d);
  for (const id of more.slice(0, 3)) await processCall(d, id);
  return { ok: true };
}
