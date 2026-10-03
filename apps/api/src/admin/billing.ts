// Invoicing (docs/plan.md, section 16, module 15): MedInnova invoices the call centres. The rules
// live in the database (0017_invoicing.sql and 0019_billing_v2.sql): numbering when sent,
// frozen invoices, payments, credit notes, access and modules from packages, scheduled sending,
// fixed agreements and missed payments. This module validates input, makes PDFs and e-mails,
// and gives clear answers.
import type pg from "pg";
import type { Session } from "../auth/session.ts";
import { emailEnabled, sendEmail } from "../email.ts";
import { withSession } from "../me.ts";
import { type InvoiceForEmail, invoiceEmail } from "./invoice-email.ts";
import { type InvoiceForPdf, invoicePdf, type Logo } from "./invoice-pdf.ts";
import { NotFound } from "./organizations.ts";
import { BadRequest, type Body, isUuid, optionalText, requiredText } from "./validate.ts";
import { isModuleKey } from "@veriqall/shared";
import { PDFDocument } from "pdf-lib";

export const VAT_RATES = [0.25, 0.15, 0.12, 0] as const;
const INTERVALS = [1, 3, 6, 12];
const METHODS = ["bank", "stripe", "other"];
const LINE_KINDS = ["package", "text", "fee"] as const;

// "1 234,50", "1234.5" or 1234.5 as "1234.50"; at most two decimals.
export function money(value: unknown, label: string, { allowNegative = false } = {}): string {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.replace(/\s/g, "").replace(",", ".") : "";
  if (!/^-?\d{1,10}(\.\d{1,2})?$/.test(text)) throw new BadRequest(`Ugyldig beløp: ${label}.`);
  if (!allowNegative && text.startsWith("-")) throw new BadRequest(`${label} kan ikke være negativ.`);
  return Number(text).toFixed(2);
}

function quantity(value: unknown): string {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.replace(/\s/g, "").replace(",", ".") : "";
  if (!/^-?\d{1,7}(\.\d{1,3})?$/.test(text) || Number(text) === 0) throw new BadRequest("Ugyldig antall.");
  return text;
}

function date(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new BadRequest(`Ugyldig dato: ${label}.`);
  }
  return value;
}

const optionalDate = (body: Body, key: string, label: string) =>
  body[key] === undefined ? undefined : body[key] === null || body[key] === "" ? null : date(body[key], label);

export interface LineInput {
  kind: (typeof LINE_KINDS)[number];
  packageId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: number;
}

export function lines(value: unknown): LineInput[] {
  if (!Array.isArray(value) || value.length > 50) throw new BadRequest("En faktura kan ha opptil 50 linjer.");
  return value.map((raw) => {
    const line = (raw ?? {}) as Body;
    const description = typeof line.description === "string" ? line.description.trim() : "";
    if (!description || description.length > 500) throw new BadRequest("Hver linje trenger en beskrivelse (opptil 500 tegn).");
    const vatRate = line.vatRate === undefined ? 0.25 : Number(line.vatRate);
    if (!VAT_RATES.includes(vatRate as (typeof VAT_RATES)[number])) throw new BadRequest("Ugyldig mva-sats.");
    const packageId = line.packageId ?? null;
    if (packageId !== null && (typeof packageId !== "string" || !isUuid(packageId))) throw new BadRequest("Ukjent pakke.");
    const kind = (line.kind ?? (packageId ? "package" : "text")) as LineInput["kind"];
    if (!LINE_KINDS.includes(kind) || (kind === "package") !== (packageId !== null)) throw new BadRequest("Ugyldig linje.");
    return {
      kind,
      packageId,
      description,
      quantity: quantity(line.quantity ?? 1),
      unitPrice: money(line.unitPrice, "pris", { allowNegative: true }),
      vatRate,
    };
  });
}

// The database's rules as messages for the superadmin.
function translate(error: unknown): never {
  const message = (error as Error).message ?? "";
  const known: [string, string][] = [
    ["billing settings are incomplete", "Fyll ut firmanavn, organisasjonsnummer og kontonummer under Innstillinger før du sender."],
    ["at least one line", "Fakturaen trenger minst én linje."],
    ["cannot be changed", "En sendt faktura kan ikke endres. Lag en kreditnota."],
    ["only drafts", "Bare utkast og planlagte fakturaer kan slettes."],
    ["only a sent invoice", "Bare en sendt faktura kan krediteres, og bare én gang."],
    ["payments go on sent invoices", "Betaling kan bare registreres på en sendt faktura."],
    ["credited with a credit note", "En faktura krediteres med kreditnota."],
    ["future invoice date", "En planlagt faktura må ha fakturadato fram i tid."],
    ["only an invoice can be unpaid", "Bare en faktura kan få status «betaling uteblitt»."],
    ["invoices_period_check", "Perioden må slutte etter at den starter."],
    ["invoices_access_kind", "Bare fakturaer kan gi tilgang."],
  ];
  for (const [needle, text] of known) if (message.includes(needle)) throw new BadRequest(text);
  if ((error as { code?: string }).code === "23503") throw new BadRequest("Ukjent callsenter eller pakke.");
  throw error;
}

// --- Settings ---------------------------------------------------------------------------------

const SETTINGS = `company_name as "companyName", org_number as "orgNumber", vat_registered as "vatRegistered", address, email,
  account_number as "accountNumber", due_days as "dueDays", next_number as "nextNumber", footer,
  price_audio_hour::text as "priceAudioHour", price_ai_control::text as "priceAiControl", invoice_fee::text as "invoiceFee",
  recurring_days_before as "recurringDaysBefore", copy_email as "copyEmail", logo_type is not null as "hasLogo",
  updated_at as "updatedAt"`;

export async function getBillingSettings(db: pg.Pool, session: Session) {
  return withSession(db, session, async (c) => {
    const settings = (await c.query(`select ${SETTINGS} from billing_settings`)).rows[0] ?? null;
    return settings ? { ...settings, emailEnabled: emailEnabled() } : null;
  });
}

export async function updateBillingSettings(db: pg.Pool, session: Session, body: Body) {
  const digits = (key: string, length: number, label: string) => {
    const value = optionalText(body, key, label, 40);
    if (value === undefined || value === null) return value;
    const clean = value.replace(/[\s.]/g, "");
    if (!new RegExp(`^[0-9]{${length}}$`).test(clean)) throw new BadRequest(`${label} må ha ${length} siffer.`);
    return clean;
  };
  const price = (key: string, label: string) =>
    body[key] === undefined ? undefined : body[key] === null || body[key] === "" ? null : money(body[key], label);
  const values: Record<string, unknown> = {
    company_name: optionalText(body, "companyName", "Firmanavn", 200),
    org_number: digits("orgNumber", 9, "Organisasjonsnummeret"),
    address: optionalText(body, "address", "Adresse", 500),
    email: optionalText(body, "email", "E-post", 200),
    account_number: digits("accountNumber", 11, "Kontonummeret"),
    footer: optionalText(body, "footer", "Bunntekst", 1000),
    price_audio_hour: price("priceAudioHour", "pris per time lyd"),
    price_ai_control: price("priceAiControl", "pris per AI-kontroll"),
    invoice_fee: price("invoiceFee", "fakturagebyr"),
    copy_email: optionalText(body, "copyEmail", "Kopi til", 200),
  };
  for (const key of ["email", "copy_email"]) {
    if (typeof values[key] === "string" && !/^[^@\s]+@[^@\s]+$/.test(values[key] as string)) throw new BadRequest("Ugyldig e-postadresse.");
  }
  if (body.vatRegistered !== undefined) values.vat_registered = body.vatRegistered === true;
  if (body.dueDays !== undefined) {
    const days = Number(body.dueDays);
    if (!Number.isInteger(days) || days < 0 || days > 90) throw new BadRequest("Betalingsfristen må være 0–90 dager.");
    values.due_days = days;
  }
  if (body.recurringDaysBefore !== undefined) {
    const days = Number(body.recurringDaysBefore);
    if (!Number.isInteger(days) || days < 0 || days > 60) throw new BadRequest("Dager før forfall må være 0–60.");
    values.recurring_days_before = days;
  }
  if (body.nextNumber !== undefined) {
    const next = Number(body.nextNumber);
    if (!Number.isInteger(next) || next < 1) throw new BadRequest("Ugyldig fakturanummer.");
    values.next_number = next;
  }
  const sets = Object.entries(values).filter(([, v]) => v !== undefined);
  return withSession(db, session, async (c) => {
    if (values.next_number !== undefined) {
      // The sequence never goes back: no number may be used twice. The lock keeps a send from
      // slipping in between the check and the update.
      await c.query("select 1 from billing_settings for update");
      const { rows } = await c.query<{ max: number | null }>("select max(number) as max from invoices");
      if ((rows[0]?.max ?? 0) >= (values.next_number as number)) {
        throw new BadRequest(`Neste fakturanummer må være høyere enn ${rows[0]!.max}.`);
      }
    }
    if (sets.length) {
      await c.query(`update billing_settings set ${sets.map(([k], i) => `${k} = $${i + 1}`).join(", ")}, updated_at = now()`, sets.map(([, v]) => v));
    }
    return { ...(await c.query(`select ${SETTINGS} from billing_settings`)).rows[0], emailEnabled: emailEnabled() };
  });
}

// The logo on invoices: PNG or JPEG up to 500 kB, sent as base64.
export async function setLogo(db: pg.Pool, session: Session, body: Body) {
  const type = body.type;
  if (type !== "image/png" && type !== "image/jpeg") throw new BadRequest("Logoen må være PNG eller JPEG.");
  if (typeof body.data !== "string") throw new BadRequest("Mangler bildet.");
  const bytes = Buffer.from(body.data, "base64");
  if (!bytes.length || bytes.length > 500_000) throw new BadRequest("Logoen kan være opptil 500 kB.");
  // Checked by embedding it the way invoices will, so a broken image never breaks the PDFs.
  try {
    const doc = await PDFDocument.create();
    if (type === "image/png") await doc.embedPng(bytes);
    else await doc.embedJpg(bytes);
  } catch {
    throw new BadRequest("Filen er ikke et gyldig bilde.");
  }
  return withSession(db, session, async (c) => {
    await c.query("update billing_settings set logo = $1, logo_type = $2, updated_at = now()", [bytes, type]);
    return { ok: true };
  });
}

export async function deleteLogo(db: pg.Pool, session: Session) {
  return withSession(db, session, async (c) => {
    await c.query("update billing_settings set logo = null, logo_type = null, updated_at = now()");
    return { ok: true };
  });
}

export async function getLogo(db: pg.Pool, session: Session): Promise<Logo | null> {
  return withSession(db, session, (c) => loadLogo(c));
}

async function loadLogo(c: pg.PoolClient): Promise<Logo | null> {
  const { rows } = await c.query<{ logo: Buffer | null; logo_type: Logo["type"] | null }>("select logo, logo_type from app.invoice_logo()");
  return rows[0]?.logo && rows[0].logo_type ? { bytes: new Uint8Array(rows[0].logo), type: rows[0].logo_type } : null;
}

// --- Packages ---------------------------------------------------------------------------------

const PACKAGE = `id, name, description, unit_price::text as "unitPrice", vat_rate::float as "vatRate", modules, active,
  stripe_price_id as "stripePriceId", updated_at as "updatedAt"`;

function packageValues(body: Body, creating: boolean) {
  const values: Record<string, unknown> = {
    name: creating ? requiredText(body, "name", "Navn", 200) : optionalText(body, "name", "Navn", 200),
    description: optionalText(body, "description", "Beskrivelse", 1000),
    unit_price: body.unitPrice === undefined && !creating ? undefined : money(body.unitPrice, "pris"),
  };
  if (values.name === null) throw new BadRequest("Navn må fylles ut.");
  if (body.vatRate !== undefined) {
    const rate = Number(body.vatRate);
    if (!VAT_RATES.includes(rate as (typeof VAT_RATES)[number])) throw new BadRequest("Ugyldig mva-sats.");
    values.vat_rate = rate;
  }
  if (body.modules !== undefined) {
    if (!Array.isArray(body.modules) || !body.modules.every(isModuleKey)) throw new BadRequest("Ukjent modul.");
    values.modules = [...new Set(body.modules as string[])];
  }
  if (body.active !== undefined) values.active = body.active === true;
  return values;
}

export async function listPackages(db: pg.Pool, session: Session) {
  return withSession(db, session, async (c) => (await c.query(`select ${PACKAGE} from billing_packages order by active desc, name`)).rows);
}

export async function createPackage(db: pg.Pool, session: Session, body: Body) {
  const v = Object.entries(packageValues(body, true)).filter(([, x]) => x !== undefined);
  return withSession(db, session, async (c) => {
    const { rows } = await c.query(
      `insert into billing_packages (${v.map(([k]) => k).join(", ")}) values (${v.map((_, i) => `$${i + 1}`).join(", ")}) returning ${PACKAGE}`,
      v.map(([, x]) => x),
    );
    return rows[0];
  });
}

export async function updatePackage(db: pg.Pool, session: Session, id: string, body: Body) {
  const v = Object.entries(packageValues(body, false)).filter(([, x]) => x !== undefined);
  return withSession(db, session, async (c) => {
    const { rows } = v.length
      ? await c.query(
          `update billing_packages set ${v.map(([k], i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() where id = $1 returning ${PACKAGE}`,
          [id, ...v.map(([, x]) => x)],
        )
      : await c.query(`select ${PACKAGE} from billing_packages where id = $1`, [id]);
    if (!rows[0]) throw new NotFound();
    return rows[0];
  });
}

// --- Customers --------------------------------------------------------------------------------

// The call centres as invoice customers: fixed customer number, invoice details, access from
// invoices, and what they owe.
export async function listCustomers(db: pg.Pool, session: Session) {
  return withSession(db, session, async (c) => {
    const { rows } = await c.query(
      `select o.id, o.customer_number as "customerNumber", o.name, o.org_number as "orgNumber", o.invoice_email as "invoiceEmail",
              o.invoice_address as "invoiceAddress", o.contact_name as "contactName", o.status, o.trial_ends_at as "trialEndsAt",
              o.access_until as "accessUntil", app.organization_open(o) as open,
              (select count(*)::int from invoices i where i.organization_id = o.id and i.status not in ('draft', 'scheduled')) as invoices,
              (select coalesce(sum(i.total - coalesce((select sum(p.amount) from invoice_payments p where p.invoice_id = i.id), 0)), 0)
               from invoices i where i.organization_id = o.id and i.kind = 'invoice' and i.status in ('sent', 'payment_missed'))::text as outstanding,
              (select count(*)::int from recurring_invoices r where r.organization_id = o.id and r.active) as agreements
       from organizations o
       order by o.customer_number`,
    );
    return rows;
  });
}

// Opens a call centre again by hand (or closes it): access until a date, or not controlled by
// invoices at all (null).
export async function setCustomerAccess(db: pg.Pool, session: Session, id: string, body: Body) {
  const until = optionalDate(body, "until", "tilgang til");
  if (until === undefined) throw new BadRequest("Velg en dato, eller fjern grensen.");
  return withSession(db, session, async (c) => {
    const { rowCount } = await c.query(
      "update organizations set access_until = case when $2::date is null then null else ($2::date + 1)::timestamp at time zone 'Europe/Oslo' end where id = $1",
      [id, until],
    );
    if (!rowCount) throw new NotFound();
    return { ok: true };
  });
}

// --- Invoices ---------------------------------------------------------------------------------

// Lines summed the way the database does when it sends, so a draft shows the same totals.
const TOTALS = `
  coalesce(i.subtotal, (select coalesce(sum(round(l.quantity * l.unit_price, 2)), 0) from invoice_lines l where l.invoice_id = i.id))::text as subtotal,
  coalesce(i.vat, (select coalesce(sum(round(round(l.quantity * l.unit_price, 2) * case when (select vat_registered from billing_settings) is false then 0 else l.vat_rate end, 2)), 0)
                   from invoice_lines l where l.invoice_id = i.id))::text as vat,
  coalesce(i.total, (select coalesce(sum(round(l.quantity * l.unit_price, 2) + round(round(l.quantity * l.unit_price, 2) * case when (select vat_registered from billing_settings) is false then 0 else l.vat_rate end, 2)), 0)
                     from invoice_lines l where l.invoice_id = i.id))::text as total,
  (select coalesce(sum(p.amount), 0) from invoice_payments p where p.invoice_id = i.id)::text as paid`;

const SUMMARY = `i.id, i.organization_id as "organizationId", o.name as "organizationName", o.customer_number as "customerNumber",
  i.kind, i.credit_of as "creditOf", i.status, i.number, i.issue_date::text as "issueDate", i.due_date::text as "dueDate", i.note,
  i.sent_at as "sentAt", i.paid_at as "paidAt", i.missed_at as "missedAt", i.created_at as "createdAt", i.recurring_id as "recurringId",
  i.grant_access as "grantAccess", i.period_start::text as "periodStart", i.period_end::text as "periodEnd",
  (i.status = 'sent' and i.kind = 'invoice' and i.due_date < app.oslo_today()) as overdue, ${TOTALS}`;

const STATUSES = ["draft", "scheduled", "sent", "paid", "credited", "payment_missed", "overdue"];

export async function listInvoices(db: pg.Pool, session: Session, query: Record<string, string | undefined>) {
  const status = STATUSES.includes(query.status ?? "") ? query.status! : null;
  const org = query.organizationId && isUuid(query.organizationId) ? query.organizationId : null;
  return withSession(db, session, async (c) => {
    const { rows } = await c.query(
      `select ${SUMMARY}
       from invoices i join organizations o on o.id = i.organization_id
       where ($1::text is null or ($1 = 'overdue' and i.status = 'sent' and i.kind = 'invoice' and i.due_date < app.oslo_today()) or i.status = $1)
         and ($2::uuid is null or i.organization_id = $2)
       order by i.number desc nulls first, i.created_at desc
       limit 500`,
      [status, org],
    );
    return rows;
  });
}

// One invoice with its lines and payments. Used by superadmins, by call centres (under RLS)
// and by the worker.
export async function invoiceDetail(c: pg.PoolClient, id: string) {
  const { rows } = await c.query(
    `select ${SUMMARY}, i.seller, i.recipient, o.org_number as "organizationOrgNumber",
            o.invoice_email as "organizationInvoiceEmail", o.invoice_address as "organizationInvoiceAddress",
            (select number from invoices x where x.id = i.credit_of) as "creditOfNumber",
            (select json_build_object('id', x.id, 'number', x.number) from invoices x where x.credit_of = i.id) as "creditNote"
     from invoices i join organizations o on o.id = i.organization_id
     where i.id = $1`,
    [id],
  );
  if (!rows[0]) throw new NotFound();
  const lines = await c.query(
    `select id, position, kind, package_id as "packageId", description, quantity::text, unit_price::text as "unitPrice",
            vat_rate::float as "vatRate", round(quantity * unit_price, 2)::text as amount
     from invoice_lines where invoice_id = $1 order by position, id`,
    [id],
  );
  const payments = await c.query(
    `select id, amount::text, paid_on::text as "paidOn", method, reference, created_at as "createdAt"
     from invoice_payments where invoice_id = $1 order by paid_on, created_at`,
    [id],
  );
  // Superadmins and the worker only (RLS): when and to whom the invoice was e-mailed.
  const emails = await c.query(
    `select sent_to as "sentTo", sent_at as "sentAt" from invoice_emails where invoice_id = $1 order by sent_at`,
    [id],
  );
  return { ...rows[0], lines: lines.rows, payments: payments.rows, emails: emails.rows };
}

export async function getInvoice(db: pg.Pool, session: Session, id: string) {
  return withSession(db, session, (c) => invoiceDetail(c, id));
}

// The invoice as a PDF. A draft shows the seller and the call centre as they are now.
export async function invoicePdfFor(c: pg.PoolClient, id: string): Promise<{ pdf: Uint8Array; filename: string }> {
  const detail = (await invoiceDetail(c, id)) as unknown as InvoiceForPdf & { customerNumber: number; organizationName: string };
  let preview: Parameters<typeof invoicePdf>[2];
  if (!detail.seller) {
    const s = (await c.query(`select ${SETTINGS} from billing_settings`)).rows[0] ?? {};
    const o = (
      await c.query(
        `select name, org_number as "orgNumber", invoice_address as address, invoice_email as email, contact_name as "contactName",
                customer_number as "customerNumber"
         from organizations where id = (select organization_id from invoices where id = $1)`,
        [id],
      )
    ).rows[0];
    preview = {
      seller: { name: s.companyName, orgNumber: s.orgNumber, vatRegistered: s.vatRegistered, address: s.address, email: s.email, accountNumber: s.accountNumber, footer: s.footer },
      recipient: o ?? {},
    };
  }
  const pdf = await invoicePdf(detail, await loadLogo(c), preview);
  const name = detail.number === null ? "fakturautkast" : `${detail.kind === "credit" ? "kreditnota" : "faktura"}-${detail.number}`;
  return { pdf, filename: `${name}.pdf` };
}

export async function getInvoicePdf(db: pg.Pool, session: Session, id: string) {
  return withSession(db, session, (c) => invoicePdfFor(c, id));
}

async function writeLines(c: pg.PoolClient, id: string, org: string, input: LineInput[]) {
  await c.query("delete from invoice_lines where invoice_id = $1", [id]);
  for (const [i, l] of input.entries()) {
    await c.query(
      `insert into invoice_lines (invoice_id, organization_id, position, kind, package_id, description, quantity, unit_price, vat_rate)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, org, i, l.kind, l.packageId, l.description, l.quantity, l.unitPrice, l.vatRate],
    );
  }
}

function invoiceFields(body: Body) {
  return {
    note: optionalText(body, "note", "Merknad", 2000),
    issue_date: optionalDate(body, "issueDate", "fakturadato"),
    due_date: optionalDate(body, "dueDate", "forfall"),
    period_start: optionalDate(body, "periodStart", "periodestart"),
    period_end: optionalDate(body, "periodEnd", "periodeslutt"),
    grant_access: body.grantAccess === undefined ? undefined : body.grantAccess === true,
  };
}

export async function createInvoice(db: pg.Pool, session: Session, body: Body) {
  const org = body.organizationId;
  if (typeof org !== "string" || !isUuid(org)) throw new BadRequest("Velg callsenteret.");
  const input = body.lines === undefined ? [] : lines(body.lines);
  const fields = Object.entries(invoiceFields(body)).filter(([, v]) => v !== undefined);
  return withSession(db, session, async (c) => {
    try {
      const { rows } = await c.query<{ id: string }>(
        `insert into invoices (organization_id, created_by${fields.map(([k]) => `, ${k}`).join("")})
         values ($1, app.current_user_id()${fields.map((_, i) => `, $${i + 2}`).join("")}) returning id`,
        [org, ...fields.map(([, v]) => v)],
      );
      await writeLines(c, rows[0]!.id, org, input);
      return { id: rows[0]!.id };
    } catch (error) {
      translate(error);
    }
  });
}

// A draft or scheduled invoice: dates, period, access, note and lines (all lines are replaced
// when given). A scheduled invoice whose date is no longer in the future becomes a draft again.
export async function updateInvoice(db: pg.Pool, session: Session, id: string, body: Body) {
  const input = body.lines === undefined ? undefined : lines(body.lines);
  const fields = Object.entries(invoiceFields(body)).filter(([, v]) => v !== undefined);
  return withSession(db, session, async (c) => {
    const { rows } = await c.query<{ organization_id: string; status: string }>(
      "select organization_id, status from invoices where id = $1 for update",
      [id],
    );
    if (!rows[0]) throw new NotFound();
    if (rows[0].status !== "draft" && rows[0].status !== "scheduled") throw new BadRequest("En sendt faktura kan ikke endres. Lag en kreditnota.");
    try {
      if (fields.length) {
        const issue = fields.find(([k]) => k === "issue_date");
        const n = fields.length;
        await c.query(
          `update invoices set ${fields.map(([k], i) => `${k} = $${i + 2}`).join(", ")},
             status = case when status = 'scheduled'
               and coalesce(case when $${n + 2} then $${n + 3}::date else issue_date end <= app.oslo_today(), true) then 'draft' else status end
           where id = $1`,
          [id, ...fields.map(([, v]) => v), issue !== undefined, issue?.[1] ?? null],
        );
      }
      if (input) await writeLines(c, id, rows[0].organization_id, input);
    } catch (error) {
      translate(error);
    }
    return invoiceDetail(c, id);
  });
}

export async function deleteInvoice(db: pg.Pool, session: Session, id: string) {
  return withSession(db, session, async (c) => {
    try {
      const { rowCount } = await c.query("delete from invoices where id = $1", [id]);
      if (!rowCount) throw new NotFound();
    } catch (error) {
      if (error instanceof NotFound) throw error;
      translate(error);
    }
    return { ok: true };
  });
}

// E-mails an invoice with the PDF to the address frozen on it, with a blind copy to the copy
// address in the settings, and logs it. Used by the API and by the worker's morning run.
export async function deliverInvoice(c: pg.PoolClient, id: string): Promise<boolean> {
  const detail = (await invoiceDetail(c, id)) as unknown as InvoiceForEmail & {
    status: string;
    organizationId: string;
    recipient: { email?: string | null } | null;
  };
  if (detail.status === "draft" || detail.status === "scheduled") throw new BadRequest("Send fakturaen før den sendes på e-post.");
  const to = detail.recipient?.email;
  if (!to) throw new BadRequest("Callsenteret hadde ingen faktura-e-post da fakturaen ble sendt.");
  const copy = (await c.query<{ copy_email: string | null }>("select copy_email from billing_settings")).rows[0]?.copy_email;
  const { pdf, filename } = await invoicePdfFor(c, id);
  const messageId = await sendEmail({
    to,
    bcc: copy && copy !== to ? [copy] : undefined,
    ...invoiceEmail(detail),
    attachments: [{ filename, contentType: "application/pdf", content: pdf }],
  });
  if (messageId === null) return false;
  await c.query(
    `insert into invoice_emails (invoice_id, organization_id, sent_to, message_id, sent_by)
     values ($1, $2, $3, $4, app.current_user_id())`,
    [id, detail.organizationId, to, messageId.slice(0, 200) || null],
  );
  return true;
}

// Sends after the invoice is committed; a failed e-mail does not undo the sending.
async function deliverAfterCommit(db: pg.Pool, session: Session, id: string): Promise<boolean> {
  if (!emailEnabled()) return false;
  try {
    return await withSession(db, session, (c) => deliverInvoice(c, id));
  } catch (error) {
    if (!(error instanceof BadRequest)) console.error("invoice e-mail failed", error);
    return false;
  }
}

// Sends the invoice: numbered, frozen and e-mailed with the PDF. With an invoice date in the
// future it is scheduled instead, and sent that morning.
export async function sendInvoice(db: pg.Pool, session: Session, id: string) {
  const status = await withSession(db, session, async (c) => {
    const { rows } = await c.query<{ status: string; future: boolean }>(
      "select status, coalesce(issue_date > app.oslo_today(), false) as future from invoices where id = $1 for update",
      [id],
    );
    if (!rows[0]) throw new NotFound();
    if (rows[0].status !== "draft" && rows[0].status !== "scheduled") throw new BadRequest("Fakturaen er allerede sendt.");
    const next = rows[0].future ? "scheduled" : "sent";
    try {
      await c.query("update invoices set status = $2 where id = $1", [id, next]);
    } catch (error) {
      translate(error);
    }
    return next;
  });
  const emailed = status === "sent" ? await deliverAfterCommit(db, session, id) : false;
  return { ...(await getInvoice(db, session, id)), emailed };
}

export async function unscheduleInvoice(db: pg.Pool, session: Session, id: string) {
  return withSession(db, session, async (c) => {
    const { rowCount } = await c.query("update invoices set status = 'draft' where id = $1 and status = 'scheduled'", [id]);
    if (!rowCount) throw new BadRequest("Fakturaen er ikke planlagt.");
    return invoiceDetail(c, id);
  });
}

// Payment missed by hand: the call centre closes at once (the morning run does it 5 days after
// the due date for invoices with access).
export async function markPaymentMissed(db: pg.Pool, session: Session, id: string) {
  return withSession(db, session, async (c) => {
    try {
      const { rowCount } = await c.query("update invoices set status = 'payment_missed' where id = $1 and status = 'sent' and kind = 'invoice'", [id]);
      if (!rowCount) throw new BadRequest("Bare en sendt, ubetalt faktura kan få status «betaling uteblitt».");
    } catch (error) {
      if (error instanceof BadRequest) throw error;
      translate(error);
    }
    return invoiceDetail(c, id);
  });
}

export async function addPayment(db: pg.Pool, session: Session, id: string, body: Body) {
  const amount = money(body.amount, "beløp");
  if (Number(amount) <= 0) throw new BadRequest("Beløpet må være større enn null.");
  const paidOn = date(body.paidOn, "betalt");
  const method = body.method ?? "bank";
  if (!METHODS.includes(method as string)) throw new BadRequest("Ukjent betalingsmåte.");
  const reference = optionalText(body, "reference", "Referanse", 200) ?? null;
  return withSession(db, session, async (c) => {
    const { rows } = await c.query<{ organization_id: string }>("select organization_id from invoices where id = $1", [id]);
    if (!rows[0]) throw new NotFound();
    try {
      await c.query(
        `insert into invoice_payments (invoice_id, organization_id, amount, paid_on, method, reference, created_by)
         values ($1, $2, $3, $4, $5, $6, app.current_user_id())`,
        [id, rows[0].organization_id, amount, paidOn, method, reference],
      );
    } catch (error) {
      translate(error);
    }
    return invoiceDetail(c, id);
  });
}

export async function creditInvoice(db: pg.Pool, session: Session, id: string, body: Body) {
  const reason = optionalText(body, "reason", "Begrunnelse", 2000) ?? null;
  const credit = await withSession(db, session, async (c) => {
    try {
      const { rows } = await c.query<{ id: string }>("select app.credit_invoice($1, $2) as id", [id, reason]);
      return rows[0]!.id;
    } catch (error) {
      translate(error);
    }
  });
  const emailed = await deliverAfterCommit(db, session, credit);
  return { id: credit, emailed };
}

export async function emailInvoice(db: pg.Pool, session: Session, id: string) {
  if (!emailEnabled()) throw new BadRequest("E-post er ikke satt opp ennå. Skriv ut fakturaen og send den selv.");
  return withSession(db, session, async (c) => {
    await deliverInvoice(c, id);
    return invoiceDetail(c, id);
  });
}

// Usage lines for one month of the call centre's usage, at the prices under Innstillinger.
export async function addUsageLines(db: pg.Pool, session: Session, id: string, body: Body) {
  const month = body.month;
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequest("Velg måned.");
  return withSession(db, session, async (c) => {
    const inv = await c.query<{ organization_id: string; status: string }>("select organization_id, status from invoices where id = $1 for update", [id]);
    if (!inv.rows[0]) throw new NotFound();
    if (inv.rows[0].status !== "draft" && inv.rows[0].status !== "scheduled") throw new BadRequest("En sendt faktura kan ikke endres. Lag en kreditnota.");
    const prices = (await c.query<{ audio: string | null; ai: string | null }>(
      "select price_audio_hour::text as audio, price_ai_control::text as ai from billing_settings",
    )).rows[0]!;
    if (prices.audio === null && prices.ai === null) throw new BadRequest("Sett priser for forbruk under Innstillinger først.");
    // Each call is billed once, even if it was transcribed or checked again after a failure:
    // the whole recording when it was transcribed as one, otherwise its pieces added together.
    const used = (await c.query<{ seconds: number; controls: number }>(
      `with u as (
         select id, call_id, kind, audio_seconds, piece from usage_events
         where organization_id = $1 and created_at >= ($2 || '-01')::date::timestamp at time zone 'Europe/Oslo'
           and created_at < (($2 || '-01')::date + interval '1 month')::timestamp at time zone 'Europe/Oslo'
       ), audio as (
         select coalesce(max(audio_seconds) filter (where piece is null), sum(audio_seconds)) as s
         from u where kind = 'transcription_async' group by coalesce(call_id::text, id::text)
       )
       select (select coalesce(sum(s), 0) from audio)::int as seconds,
              (select count(distinct coalesce(call_id::text, id::text)) from u where kind = 'ai_control')::int as controls`,
      [inv.rows[0].organization_id, month],
    )).rows[0]!;
    const label = new Intl.DateTimeFormat("nb-NO", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
    const position = (await c.query<{ n: number }>("select count(*)::int as n from invoice_lines where invoice_id = $1", [id])).rows[0]!.n;
    const add: [string, string, string][] = [];
    const hours = Math.ceil(used.seconds / 36) / 100; // two decimals, rounded up
    if (prices.audio !== null && hours > 0) add.push([`Transkribering ${label}, timer lyd`, hours.toFixed(2), prices.audio]);
    if (prices.ai !== null && used.controls > 0) add.push([`AI-kontroll ${label}, samtaler`, String(used.controls), prices.ai]);
    if (!add.length) throw new BadRequest("Ikke noe forbruk å fakturere for denne måneden.");
    for (const [i, [description, quantity, price]] of add.entries()) {
      await c.query(
        `insert into invoice_lines (invoice_id, organization_id, position, description, quantity, unit_price)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, inv.rows[0].organization_id, position + i, description, quantity, price],
      );
    }
    return invoiceDetail(c, id);
  });
}

// --- Fixed agreements -------------------------------------------------------------------------

const RECURRING = `r.id, r.organization_id as "organizationId", o.name as "organizationName", o.customer_number as "customerNumber",
  r.name, r.lines, r.interval_months as "intervalMonths", r.next_date::text as "nextDate",
  (r.next_date - coalesce(r.days_before, (select recurring_days_before from billing_settings)))::text as "sendDate",
  r.days_before as "daysBefore", r.grant_access as "grantAccess", r.active, r.paused, r.updated_at as "updatedAt"`;

export async function listRecurring(db: pg.Pool, session: Session) {
  return withSession(db, session, async (c) => {
    const { rows } = await c.query(
      `select ${RECURRING} from recurring_invoices r join organizations o on o.id = r.organization_id order by r.active desc, r.next_date, o.name`,
    );
    return rows;
  });
}

function recurringValues(body: Body, creating: boolean) {
  const values: Record<string, unknown> = {
    name: creating ? requiredText(body, "name", "Navn", 200) : optionalText(body, "name", "Navn", 200),
  };
  if (values.name === null) throw new BadRequest("Navn må fylles ut.");
  if (body.lines !== undefined || creating) {
    const input = lines(body.lines);
    if (!input.length) throw new BadRequest("Avtalen trenger minst én linje.");
    values.lines = JSON.stringify(input.map((l) => ({ ...l, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })));
  }
  if (body.intervalMonths !== undefined || creating) {
    const interval = Number(body.intervalMonths ?? 1);
    if (!INTERVALS.includes(interval)) throw new BadRequest("Velg hvor ofte.");
    values.interval_months = interval;
  }
  if (body.nextDate !== undefined || creating) {
    // The next due date. A new date starts a new count of periods from it.
    values.next_date = date(body.nextDate, "neste forfall");
    values.start_date = values.next_date;
    values.billed_periods = 0;
  }
  if (body.daysBefore !== undefined) {
    if (body.daysBefore === null || body.daysBefore === "") values.days_before = null;
    else {
      const days = Number(body.daysBefore);
      if (!Number.isInteger(days) || days < 0 || days > 60) throw new BadRequest("Dager før forfall må være 0–60.");
      values.days_before = days;
    }
  }
  if (body.grantAccess !== undefined) values.grant_access = body.grantAccess === true;
  if (body.active !== undefined) values.active = body.active === true;
  // Resumed by hand (normally a payment does it).
  if (body.paused === false) values.paused = false;
  return values;
}

export async function createRecurring(db: pg.Pool, session: Session, body: Body) {
  const org = body.organizationId;
  if (typeof org !== "string" || !isUuid(org)) throw new BadRequest("Velg callsenteret.");
  const v = Object.entries(recurringValues(body, true)).filter(([, x]) => x !== undefined);
  return withSession(db, session, async (c) => {
    try {
      const { rows } = await c.query<{ id: string }>(
        `insert into recurring_invoices (organization_id, created_by, ${v.map(([k]) => k).join(", ")})
         values ($1, app.current_user_id(), ${v.map((_, i) => `$${i + 2}`).join(", ")}) returning id`,
        [org, ...v.map(([, x]) => x)],
      );
      return { id: rows[0]!.id };
    } catch (error) {
      translate(error);
    }
  });
}

export async function updateRecurring(db: pg.Pool, session: Session, id: string, body: Body) {
  const sets = Object.entries(recurringValues(body, false)).filter(([, v]) => v !== undefined);
  return withSession(db, session, async (c) => {
    const { rowCount } = sets.length
      ? await c.query(`update recurring_invoices set ${sets.map(([k], i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() where id = $1`, [
          id,
          ...sets.map(([, v]) => v),
        ])
      : await c.query("select 1 from recurring_invoices where id = $1", [id]);
    if (!rowCount) throw new NotFound();
    return { id };
  });
}

export async function deleteRecurring(db: pg.Pool, session: Session, id: string) {
  return withSession(db, session, async (c) => {
    let deleted = 0;
    try {
      deleted = (await c.query("delete from recurring_invoices where id = $1", [id])).rowCount ?? 0;
    } catch (error) {
      translate(error);
    }
    if (!deleted) throw new NotFound();
    return { ok: true };
  });
}

// "Kjør nå": what the morning run does (scheduled invoices, fixed agreements due, missed
// payments), then e-mails what was sent.
export async function runBilling(db: pg.Pool, session: Session) {
  const sent = await withSession(db, session, async (c) => (await c.query<{ id: string }>("select app.billing_daily() as id")).rows.map((r) => r.id));
  let emailed = 0;
  for (const id of sent) if (await deliverAfterCommit(db, session, id)) emailed++;
  return { sent: sent.length, emailed };
}

// --- Overview ---------------------------------------------------------------------------------

// Key figures, excluding VAT: monthly recurring revenue from active agreements, what was invoiced
// this month and this year (credit notes subtracted), and what is outstanding and overdue.
export async function billingOverview(db: pg.Pool, session: Session) {
  return withSession(db, session, async (c) => {
    const { rows } = await c.query(
      `select
         (select coalesce(sum((l->>'quantity')::numeric * (l->>'unitPrice')::numeric / r.interval_months), 0)
          from recurring_invoices r, jsonb_array_elements(r.lines) l where r.active and not r.paused)::numeric(12, 2)::text as mrr,
         (select coalesce(sum(subtotal), 0) from invoices where status not in ('draft', 'scheduled')
            and issue_date >= date_trunc('month', app.oslo_today()))::text as "invoicedMonth",
         (select coalesce(sum(subtotal), 0) from invoices where status not in ('draft', 'scheduled')
            and issue_date >= date_trunc('year', app.oslo_today()))::text as "invoicedYear",
         (select coalesce(sum(i.total - coalesce((select sum(amount) from invoice_payments p where p.invoice_id = i.id), 0)), 0)
          from invoices i where i.status in ('sent', 'payment_missed') and i.kind = 'invoice')::text as outstanding,
         (select coalesce(sum(i.total - coalesce((select sum(amount) from invoice_payments p where p.invoice_id = i.id), 0)), 0)
          from invoices i where i.status in ('sent', 'payment_missed') and i.kind = 'invoice' and i.due_date < app.oslo_today())::text as overdue,
         (select count(*)::int from invoices where status = 'draft') as drafts,
         (select count(*)::int from invoices where status = 'scheduled') as scheduled,
         (select count(*)::int from invoices where status = 'payment_missed') as missed`,
    );
    return rows[0];
  });
}
