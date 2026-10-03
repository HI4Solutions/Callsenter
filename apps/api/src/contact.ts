// The contact form on the landing page (docs/plan.md, section 20): POST /contact, without a
// session. The request is stored for superadmins (Meldinger → Henvendelser), and every superadmin
// with an e-mail address is told about it when e-mail is set up.
import type pg from "pg";
import { LOCALES } from "@veriqall/shared";
import { BadRequest, type Body, optionalText, requiredText } from "./admin/validate.ts";
import { emailEnabled, emailHtml, escapeHtml, sendEmail } from "./email.ts";
import { currentLocale } from "./i18n/translate.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ContactRequest {
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  message: string;
}

export function contactRequestFields(body: Body): ContactRequest {
  const name = requiredText(body, "name", "Navn", 200);
  const email = requiredText(body, "email", "E-post", 320);
  if (!EMAIL.test(email)) throw new BadRequest("E-postadressen er ugyldig.");
  const phone = optionalText(body, "phone", "Telefon", 40) ?? null;
  const company = optionalText(body, "company", "Firma", 200) ?? null;
  const message = requiredText(body, "message", "Melding", 4000);
  return { name, email, phone, company, message };
}

export async function createContactRequest(authDb: pg.Pool, body: Body, meta: { ip?: string; userAgent?: string }): Promise<{ ok: true }> {
  // A field people never see: bots fill every field. Their requests are dropped quietly.
  if (typeof body.website === "string" && body.website.trim() !== "") return { ok: true };
  const request = contactRequestFields(body);
  const locale = currentLocale();
  try {
    await authDb.query("select app.contact_request_create($1, $2, $3, $4, $5, $6, $7, $8)", [
      request.name,
      request.email,
      request.phone,
      request.company,
      request.message,
      locale,
      meta.ip ?? null,
      meta.userAgent ?? null,
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === "23514") throw new BadRequest("For mange henvendelser. Prøv igjen senere.");
    throw error;
  }
  await notifySuperadmins(authDb, request, locale).catch((error) => console.error("contact request: could not send e-mail", error));
  return { ok: true };
}

// To us, in Norwegian: the request as it was written, and which language the visitor used.
async function notifySuperadmins(authDb: pg.Pool, request: ContactRequest, locale: string) {
  if (!emailEnabled()) return;
  const { rows } = await authDb.query<{ email: string }>("select email from app.contact_request_recipients() as email");
  if (!rows.length) return;
  const subject = `Ny henvendelse fra landingssiden: ${request.name}`;
  const lines = [
    `Navn: ${request.name}`,
    `E-post: ${request.email}`,
    `Telefon: ${request.phone ?? "–"}`,
    `Firma: ${request.company ?? "–"}`,
    `Språk: ${LOCALES[locale as keyof typeof LOCALES]?.name ?? locale}`,
    "",
    request.message,
  ];
  const text = `${lines.join("\n")}\n\nSvar direkte til ${request.email}. Henvendelsen står også under Superadmin → Meldinger.`;
  const html = emailHtml(
    subject,
    `<p>${lines
      .slice(0, 5)
      .map((l) => escapeHtml(l))
      .join("<br>")}</p><p style="white-space:pre-wrap">${escapeHtml(request.message)}</p><p style="font-size:14px;color:#666">Svar direkte til <a href="mailto:${escapeHtml(request.email)}">${escapeHtml(request.email)}</a>. Henvendelsen står også under Superadmin → Meldinger.</p>`,
  );
  await Promise.all(rows.map((r) => sendEmail({ to: r.email, subject, text, html })));
}
