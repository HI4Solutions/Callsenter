// E-mail through Amazon SES in the environment's own region (docs/plan.md, section 17). The
// Lambda's role may only send from EMAIL_FROM on the environment's domain; there is no API key.
// Without EMAIL_FROM (no domain set up yet), nothing is sent and callers show the link instead.
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { DEFAULT_LOCALE, type Locale } from "@veriqall/shared";
import { DOCUMENT_TEXTS } from "./i18n/documents.ts";

export interface Attachment {
  filename: string;
  contentType: string;
  content: Uint8Array;
}

export interface Email {
  to: string;
  // Blind copies, for example the bookkeeping inbox.
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: Attachment[];
  // Where answers go, for example the superadmin who wrote a reply.
  replyTo?: string;
}

// RFC 2047 for headers with non-ASCII characters (æøå).
function header(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function base64Lines(data: Uint8Array | string): string {
  return (Buffer.from(data).toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

// A MIME message with text, optional HTML and attachments (SES raw sending).
export function mimeMessage(from: string, email: Email): Uint8Array {
  const id = () => `b_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const mixed = id();
  const alternative = id();
  const lines = [
    `From: ${from.replace(/^([^<]+)</, (_, name: string) => `${header(name.trim())} <`)}`,
    `To: ${email.to}`,
    ...(email.replyTo ? [`Reply-To: ${email.replyTo}`] : []),
    `Subject: ${header(email.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alternative}"`,
    "",
    `--${alternative}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(email.text),
    ...(email.html
      ? [`--${alternative}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", base64Lines(email.html)]
      : []),
    `--${alternative}--`,
  ];
  for (const a of email.attachments ?? []) {
    lines.push(
      `--${mixed}`,
      `Content-Type: ${a.contentType}; name="${header(a.filename)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${header(a.filename)}"`,
      "",
      base64Lines(a.content),
    );
  }
  lines.push(`--${mixed}--`, "");
  return Buffer.from(lines.join("\r\n"), "utf8");
}

export type Mailer = (email: Email) => Promise<string | undefined>;

let mailer: Mailer | null | undefined;

// For tests: a fake mailer, or null for "not set up".
export function setMailer(value: Mailer | null | undefined) {
  mailer = value;
}

function sesMailer(): Mailer | null {
  const from = process.env.EMAIL_FROM;
  if (!from) return null;
  const client = new SESv2Client({});
  return async (email) => {
    if (email.attachments?.length || email.bcc?.length) {
      const result = await client.send(
        new SendEmailCommand({
          FromEmailAddress: from,
          ReplyToAddresses: email.replyTo ? [email.replyTo] : undefined,
          Destination: { ToAddresses: [email.to], BccAddresses: email.bcc },
          Content: { Raw: { Data: mimeMessage(from, email) } },
        }),
      );
      return result.MessageId;
    }
    const result = await client.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        ReplyToAddresses: email.replyTo ? [email.replyTo] : undefined,
        Destination: { ToAddresses: [email.to] },
        Content: {
          Simple: {
            Subject: { Data: email.subject, Charset: "UTF-8" },
            Body: {
              Text: { Data: email.text, Charset: "UTF-8" },
              ...(email.html ? { Html: { Data: email.html, Charset: "UTF-8" } } : {}),
            },
          },
        },
      }),
    );
    return result.MessageId;
  };
}

export function emailEnabled(): boolean {
  if (mailer === undefined) mailer = sesMailer();
  return mailer !== null;
}

// Sends one e-mail. Returns the message id, or null when e-mail is not set up.
export async function sendEmail(email: Email): Promise<string | null> {
  if (!emailEnabled()) return null;
  return (await mailer!(email)) ?? "";
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// A plain layout that reads well in every mail client, light and dark.
export function emailHtml(title: string, bodyHtml: string, locale: Locale = DEFAULT_LOCALE): string {
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a;background:#ffffff">
<div style="max-width:640px;margin:0 auto">${bodyHtml}
<p style="margin-top:32px;font-size:13px;color:#666">VeriQall</p></div></body></html>`;
}

// The invitation e-mail, in the language of the call centre the person is invited to.
export function invitationEmail(name: string, organization: string, link: string, locale: Locale = DEFAULT_LOCALE) {
  const t = DOCUMENT_TEXTS[locale].invitation;
  const subject = t.subject(organization);
  const text = `${t.hello(name)}\n\n${t.invited(organization)} ${t.signInBelow}\n\n${link}\n\n${t.personal}`;
  const html = emailHtml(
    subject,
    `<p>${escapeHtml(t.hello(name))}</p><p>${t.invited(`<strong>${escapeHtml(organization)}</strong>`)} ${escapeHtml(t.signIn)}</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:#1f3b73;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">${escapeHtml(t.accept)}</a></p>
<p style="font-size:14px;color:#666">${escapeHtml(t.personal)}</p>`,
    locale,
  );
  return { subject, text, html };
}

// The invitation link, sent when the invited person has an e-mail address.
export async function sendInvitation(to: string, name: string, organization: string, link: string, locale: Locale = DEFAULT_LOCALE): Promise<boolean> {
  const { subject, text, html } = invitationEmail(name, organization, link, locale);
  try {
    return (await sendEmail({ to, subject, text, html })) !== null;
  } catch (error) {
    // The invitation stands; the admin can copy the link instead.
    console.error("invitation e-mail failed", error);
    return false;
  }
}
