// E-mail through Amazon SES in the environment's own region (docs/plan.md, section 17). The
// Lambda's role may only send from EMAIL_FROM on the environment's domain; there is no API key.
// Without EMAIL_FROM (no domain set up yet), nothing is sent and callers show the link instead.
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";

export interface Email {
  to: string;
  subject: string;
  text: string;
  html?: string;
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
    const result = await client.send(
      new SendEmailCommand({
        FromEmailAddress: from,
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
export function emailHtml(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="nb"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a;background:#ffffff">
<div style="max-width:640px;margin:0 auto">${bodyHtml}
<p style="margin-top:32px;font-size:13px;color:#666">VeriQall</p></div></body></html>`;
}

// The invitation link, sent when the invited person has an e-mail address.
export async function sendInvitation(to: string, name: string, organization: string, link: string): Promise<boolean> {
  const subject = `Invitasjon til ${organization} i VeriQall`;
  const text = `Hei ${name},\n\nDu er invitert til ${organization} i VeriQall. Logg inn med BankID eller Vipps via lenken under:\n\n${link}\n\nLenken er personlig og kan bare brukes én gang.`;
  const html = emailHtml(
    subject,
    `<p>Hei ${escapeHtml(name)},</p><p>Du er invitert til <strong>${escapeHtml(organization)}</strong> i VeriQall. Logg inn med BankID eller Vipps:</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:#1f3b73;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">Godta invitasjonen</a></p>
<p style="font-size:14px;color:#666">Lenken er personlig og kan bare brukes én gang.</p>`,
  );
  try {
    return (await sendEmail({ to, subject, text, html })) !== null;
  } catch (error) {
    // The invitation stands; the admin can copy the link instead.
    console.error("invitation e-mail failed", error);
    return false;
  }
}
