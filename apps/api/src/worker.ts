// Worker Lambda (docs/plan.md, section 13). Started by the API when a recording is done
// ({callId}), it transcribes and analyses that call, then tidies up: deletes calls past their
// retention, finishes abandoned recordings and frees calls a crashed run left behind. With
// {reportId} it writes a note asked for in the studio (docs/plan.md, section 18), and with
// {callId, piece} it transcribes one piece of a call that is still being recorded. Every
// morning ({task: "daily"}, EventBridge) it also runs invoicing (docs/plan.md, section 16), and
// SES starts it with each e-mail received for the inbound address (src/inbound.ts).
import type pg from "pg";
import { deliverInvoice } from "./admin/billing.ts";
import { updateUsdNok } from "./exchange.ts";
import { type WorkerDeps, housekeeping, pendingReports, processCall, processPiece, processReport } from "./calls/process.ts";
import { loadAi, loadSoniox } from "./calls/runtime.ts";
import { s3Store } from "./calls/store.ts";
import { iamPool } from "./db.ts";
import { isSesEvent, receiveEmails } from "./inbound.ts";
import { required } from "./env.ts";

let deps: Promise<WorkerDeps> | undefined;
let inboundDb: pg.Pool | undefined;

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

// A call can take up to about 12 minutes (Soniox up to 9, then the AI steps); further calls are
// started only while there is room for a whole one.
const PER_CALL_MS = 12.5 * 60_000;

// Sends scheduled invoices and fixed agreements that are due, marks missed payments, and
// e-mails what was sent. A failed e-mail is logged and does not stop the rest.
export async function billingDaily(db: pg.Pool) {
  const sent = (await db.query<{ id: string }>("select app.billing_daily() as id")).rows.map((r) => r.id);
  let emailed = 0;
  for (const id of sent) {
    const c = await db.connect();
    try {
      await c.query("begin");
      if (await deliverInvoice(c, id)) emailed++;
      await c.query("commit");
    } catch (error) {
      await c.query("rollback");
      console.error("invoice e-mail failed", id, error);
    } finally {
      c.release();
    }
  }
  return { sent: sent.length, emailed };
}

export async function handler(event: { callId?: unknown; reportId?: unknown; piece?: unknown; task?: unknown }, context?: { getRemainingTimeInMillis(): number }) {
  // E-mail received by SES for the inbound address (src/inbound.ts): only that.
  if (isSesEvent(event)) return receiveEmails((inboundDb ??= iamPool("veriqall_worker")), event, required("INBOUND_BUCKET"));
  deps ??= load();
  deps.catch(() => (deps = undefined));
  const d = await deps;
  const remaining = () => context?.getRemainingTimeInMillis() ?? Infinity;
  // A piece of a call that is still being recorded: only that, as fast as possible.
  if (typeof event.callId === "string" && /^[0-9a-f-]{36}$/.test(event.callId) && Number.isInteger(event.piece)) {
    await processPiece(d, event.callId, event.piece as number);
    return { ok: true };
  }
  if (event.task === "daily") {
    // Failures here must not stop the rest of the morning run.
    await billingDaily(d.db).then(
      (r) => console.log("billing", JSON.stringify(r)),
      (error: unknown) => console.error("billing failed", error),
    );
    // Norges Bank's USD rate for Forbruk; yesterday's stays in use if this fails.
    await updateUsdNok(d.db).then(
      (r) => console.log("usd-nok", JSON.stringify(r)),
      (error: unknown) => console.error("exchange rate failed", error),
    );
  }
  if (typeof event.callId === "string" && /^[0-9a-f-]{36}$/.test(event.callId)) await processCall(d, event.callId);
  // A note asked for in the studio.
  if (typeof event.reportId === "string" && /^[0-9a-f-]{36}$/.test(event.reportId)) await processReport(d, event.reportId);
  for (const id of await pendingReports(d.db)) {
    if (remaining() < 3 * 60_000) break;
    await processReport(d, id);
  }
  const more = await housekeeping(d, () => remaining() > 60_000);
  for (const id of more) {
    if (remaining() < PER_CALL_MS) break;
    await processCall(d, id);
  }
  return { ok: true };
}
