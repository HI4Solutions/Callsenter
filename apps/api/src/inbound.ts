// E-mail sent to the inbound address (docs/plan.md, section 20): SES receives it, stores the raw
// message in the inbound bucket and starts the worker with the SES event. The answer is stored in
// the sender's thread (contact_messages), and superadmins are told by e-mail.
import { DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type pg from "pg";
import PostalMime from "postal-mime";
import { emailEnabled, emailHtml, escapeHtml, sendEmail } from "./email.ts";

export interface SesEvent {
  Records?: {
    eventSource?: string;
    ses?: {
      mail?: { messageId?: string; source?: string };
      receipt?: { spamVerdict?: { status?: string }; virusVerdict?: { status?: string }; spfVerdict?: { status?: string } };
    };
  }[];
}

export function isSesEvent(event: unknown): event is SesEvent {
  return Array.isArray((event as SesEvent)?.Records) && (event as SesEvent).Records!.some((r) => r.eventSource === "aws:ses");
}

// The new part of an answer: the text above the quoted message, which mail programs mark in
// several languages ("On … wrote:", "Den … skrev:", "Am … schrieb:", lines starting with ">").
export function newText(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const marker =
    /^(>|-{2,}\s*(original message|opprinnelig melding|ursprungligt meddelande|oprindelig meddelelse|ursprüngliche nachricht)|(on|den|am|le)\s.*\b(wrote|skrev|schrieb|a écrit)\b.*:\s*$|from:\s|fra:\s|från:\s|von:\s)/i;
  const cut = lines.findIndex((line) => marker.test(line.trim()));
  const kept = (cut === -1 ? lines : lines.slice(0, cut)).join("\n").trim();
  return kept || text.trim();
}

export async function receiveEmails(db: pg.Pool, event: SesEvent, bucket: string, s3 = new S3Client({})) {
  let stored = 0;
  for (const record of event.Records ?? []) {
    const id = record.ses?.mail?.messageId;
    if (record.eventSource !== "aws:ses" || !id) continue;
    const key = `inbound/${id}`;
    const verdicts = record.ses?.receipt;
    // Spam and viruses never reach a superadmin.
    if (verdicts?.spamVerdict?.status === "FAIL" || verdicts?.virusVerdict?.status === "FAIL") {
      console.log("inbound: dropped", id, verdicts?.spamVerdict?.status, verdicts?.virusVerdict?.status);
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      continue;
    }
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const raw = await object.Body!.transformToByteArray();
    const mail = await PostalMime.parse(raw);
    const from = mail.from?.address?.toLowerCase();
    if (!from) {
      console.log("inbound: no sender", id);
      continue;
    }
    const text = newText(mail.text ?? (mail.html ?? "").replace(/<[^>]+>/g, " "));
    const { rows } = await db.query<{ added: boolean }>("select app.contact_message_receive($1, $2, $3, $4, $5) as added", [
      from,
      mail.from?.name ?? null,
      mail.subject ?? null,
      text,
      mail.messageId ?? id,
    ]);
    if (rows[0]?.added) {
      stored++;
      await notify(db, from, mail.from?.name ?? null, text).catch((error) => console.error("inbound: could not notify", error));
    }
  }
  return { stored };
}

async function notify(db: pg.Pool, from: string, name: string | null, text: string) {
  if (!emailEnabled()) return;
  const { rows } = await db.query<{ email: string }>("select email from app.contact_request_recipients() as email");
  const who = name ? `${name} <${from}>` : from;
  const subject = `Nytt svar fra ${name ?? from}`;
  const body = `${who} har svart:\n\n${text}\n\nSvar under Superadmin → Meldinger → Henvendelser.`;
  const html = emailHtml(
    subject,
    `<p>${escapeHtml(who)} har svart:</p><p style="white-space:pre-wrap">${escapeHtml(text)}</p><p style="font-size:14px;color:#666">Svar under Superadmin → Meldinger → Henvendelser.</p>`,
  );
  await Promise.all(rows.map((r) => sendEmail({ to: r.email, subject, text: body, html })));
}
