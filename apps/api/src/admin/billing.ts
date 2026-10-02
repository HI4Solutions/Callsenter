// Invoicing (docs/plan.md, section 16, module 15): MedInnova invoices the call centres. The rules
// (numbering when sent, frozen invoices, payments, credit notes, fixed agreements) live in the
// database (0017_invoicing.sql); this module validates input and gives clear answers.
import type pg from "pg";
import type { Session } from "../auth/session.ts";
import { withSession } from "../me.ts";
import { NotFound } from "./organizations.ts";
import { BadRequest, type Body, isUuid, optionalText, requiredText } from "./validate.ts";

export const VAT_RATES = [0.25, 0.15, 0.12, 0] as const;
const INTERVALS = [1, 3, 6, 12];
const METHODS = ["bank", "stripe", "other"];

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

export interface LineInput {
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
    return { description, quantity: quantity(line.quantity ?? 1), unitPrice: money(line.unitPrice, "pris", { allowNegative: true }), vatRate };
  });
}

// The database's rules as messages for the superadmin.
function translate(error: unknown): never {
  const message = (error as Error).message ?? "";
  const known: [string, string][] = [
    ["billing settings are incomplete", "Fyll ut firmanavn, organisasjonsnummer og kontonummer under Innstillinger før du sender."],
    ["at least one line", "Fakturaen trenger minst én linje."],
    ["cannot be changed", "En sendt faktura kan ikke endres. Lag en kreditnota."],
    ["only drafts", "Bare utkast kan slettes."],
    ["only a sent invoice", "Bare en sendt faktura kan krediteres, og bare én gang."],
    ["payments go on sent invoices", "Betaling kan bare registreres på en sendt faktura."],
  ];
  for (const [needle, text] of known) if (message.includes(needle)) throw new BadRequest(text);
  if ((error as { code?: string }).code === "23503") throw new BadRequest("Ukjent callsenter.");
  throw error;
}

// --- Settings ---------------------------------------------------------------------------------

const SETTINGS = `company_name as "companyName", org_number as "orgNumber", vat_registered as "vatRegistered", address, email,
  account_number as "accountNumber", due_days as "dueDays", next_number as "nextNumber", footer,
  price_audio_hour::text as "priceAudioHour", price_ai_control::text as "priceAiControl", updated_at as "updatedAt"`;

export async function getBillingSettings(db: pg.Pool, session: Session) {
  return withSession(db, session, async (c) => (await c.query(`select ${SETTINGS} from billing_settings`)).rows[0] ?? null);
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
  };
  if (body.vatRegistered !== undefined) values.vat_registered = body.vatRegistered === true;
  if (body.dueDays !== undefined) {
    const days = Number(body.dueDays);
    if (!Number.isInteger(days) || days < 0 || days > 90) throw new BadRequest("Betalingsfristen må være 0–90 dager.");
    values.due_days = days;
  }
  if (body.nextNumber !== undefined) {
    const next = Number(body.nextNumber);
    if (!Number.isInteger(next) || next < 1) throw new BadRequest("Ugyldig fakturanummer.");
    values.next_number = next;
  }
  if (typeof values.email === "string" && !/^[^@\s]+@[^@\s]+$/.test(values.email)) throw new BadRequest("Ugyldig e-postadresse.");
  const sets = Object.entries(values).filter(([, v]) => v !== undefined);
  return withSession(db, session, async (c) => {
    if (values.next_number !== undefined) {
      // The sequence never goes back: no number may be used twice.
      const { rows } = await c.query<{ max: number | null }>("select max(number) as max from invoices");
      if ((rows[0]?.max ?? 0) >= (values.next_number as number)) {
        throw new BadRequest(`Neste fakturanummer må være høyere enn ${rows[0]!.max}.`);
      }
    }
    if (sets.length) {
      await c.query(`update billing_settings set ${sets.map(([k], i) => `${k} = $${i + 1}`).join(", ")}, updated_at = now()`, sets.map(([, v]) => v));
    }
    return (await c.query(`select ${SETTINGS} from billing_settings`)).rows[0];
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

const SUMMARY = `i.id, i.organization_id as "organizationId", o.name as "organizationName", i.kind, i.credit_of as "creditOf",
  i.status, i.number, i.issue_date::text as "issueDate", i.due_date::text as "dueDate", i.note, i.sent_at as "sentAt",
  i.paid_at as "paidAt", i.created_at as "createdAt", i.recurring_id as "recurringId",
  (i.status = 'sent' and i.kind = 'invoice' and i.due_date < current_date) as overdue, ${TOTALS}`;

export async function listInvoices(db: pg.Pool, session: Session, query: Record<string, string | undefined>) {
  const status = ["draft", "sent", "paid", "credited", "overdue"].includes(query.status ?? "") ? query.status! : null;
  const org = query.organizationId && isUuid(query.organizationId) ? query.organizationId : null;
  return withSession(db, session, async (c) => {
    const { rows } = await c.query(
      `select ${SUMMARY}
       from invoices i join organizations o on o.id = i.organization_id
       where ($1::text is null or ($1 = 'overdue' and i.status = 'sent' and i.kind = 'invoice' and i.due_date < current_date) or i.status = $1)
         and ($2::uuid is null or i.organization_id = $2)
       order by i.number desc nulls first, i.created_at desc
       limit 500`,
      [status, org],
    );
    return rows;
  });
}

// One invoice with its lines and payments. Used by superadmins and, under RLS, by call centres.
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
    `select id, position, description, quantity::text, unit_price::text as "unitPrice", vat_rate::float as "vatRate",
            round(quantity * unit_price, 2)::text as amount
     from invoice_lines where invoice_id = $1 order by position, id`,
    [id],
  );
  const payments = await c.query(
    `select id, amount::text, paid_on::text as "paidOn", method, reference, created_at as "createdAt"
     from invoice_payments where invoice_id = $1 order by paid_on, created_at`,
    [id],
  );
  return { ...rows[0], lines: lines.rows, payments: payments.rows };
}

export async function getInvoice(db: pg.Pool, session: Session, id: string) {
  return withSession(db, session, (c) => invoiceDetail(c, id));
}

async function writeLines(c: pg.PoolClient, id: string, org: string, input: LineInput[]) {
  await c.query("delete from invoice_lines where invoice_id = $1", [id]);
  for (const [i, l] of input.entries()) {
    await c.query(
      `insert into invoice_lines (invoice_id, organization_id, position, description, quantity, unit_price, vat_rate)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, org, i, l.description, l.quantity, l.unitPrice, l.vatRate],
    );
  }
}

export async function createInvoice(db: pg.Pool, session: Session, body: Body) {
  const org = body.organizationId;
  if (typeof org !== "string" || !isUuid(org)) throw new BadRequest("Velg callsenteret.");
  const input = body.lines === undefined ? [] : lines(body.lines);
  const note = optionalText(body, "note", "Merknad", 2000) ?? null;
  const due = body.dueDate ? date(body.dueDate, "forfall") : null;
  return withSession(db, session, async (c) => {
    try {
      const { rows } = await c.query<{ id: string }>(
        "insert into invoices (organization_id, note, due_date, created_by) values ($1, $2, $3, app.current_user_id()) returning id",
        [org, note, due],
      );
      await writeLines(c, rows[0]!.id, org, input);
      return { id: rows[0]!.id };
    } catch (error) {
      translate(error);
    }
  });
}

// A draft: note, due date and lines (all lines are replaced when given).
export async function updateInvoice(db: pg.Pool, session: Session, id: string, body: Body) {
  const input = body.lines === undefined ? undefined : lines(body.lines);
  const note = optionalText(body, "note", "Merknad", 2000);
  const due = body.dueDate === undefined ? undefined : body.dueDate ? date(body.dueDate, "forfall") : null;
  return withSession(db, session, async (c) => {
    const { rows } = await c.query<{ organization_id: string; status: string }>(
      "select organization_id, status from invoices where id = $1 for update",
      [id],
    );
    if (!rows[0]) throw new NotFound();
    if (rows[0].status !== "draft") throw new BadRequest("En sendt faktura kan ikke endres. Lag en kreditnota.");
    try {
      if (note !== undefined || due !== undefined) {
        await c.query("update invoices set note = coalesce($2, note), due_date = case when $4 then $3::date else due_date end where id = $1", [
          id,
          note === undefined ? null : note,
          due ?? null,
          due !== undefined,
        ]);
        if (note === null) await c.query("update invoices set note = null where id = $1", [id]);
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

export async function sendInvoice(db: pg.Pool, session: Session, id: string) {
  return withSession(db, session, async (c) => {
    try {
      const { rowCount } = await c.query("update invoices set status = 'sent' where id = $1 and status = 'draft'", [id]);
      if (!rowCount) {
        const exists = await c.query("select 1 from invoices where id = $1", [id]);
        if (!exists.rowCount) throw new NotFound();
        throw new BadRequest("Fakturaen er allerede sendt.");
      }
    } catch (error) {
      if (error instanceof NotFound || error instanceof BadRequest) throw error;
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
  return withSession(db, session, async (c) => {
    try {
      const { rows } = await c.query<{ id: string }>("select app.credit_invoice($1, $2) as id", [id, reason]);
      return { id: rows[0]!.id };
    } catch (error) {
      translate(error);
    }
  });
}

// Usage lines for one month of the call centre's usage, at the prices under Innstillinger.
export async function addUsageLines(db: pg.Pool, session: Session, id: string, body: Body) {
  const month = body.month;
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequest("Velg måned.");
  return withSession(db, session, async (c) => {
    const inv = await c.query<{ organization_id: string; status: string }>("select organization_id, status from invoices where id = $1 for update", [id]);
    if (!inv.rows[0]) throw new NotFound();
    if (inv.rows[0].status !== "draft") throw new BadRequest("En sendt faktura kan ikke endres. Lag en kreditnota.");
    const prices = (await c.query<{ audio: string | null; ai: string | null }>(
      "select price_audio_hour::text as audio, price_ai_control::text as ai from billing_settings",
    )).rows[0]!;
    if (prices.audio === null && prices.ai === null) throw new BadRequest("Sett priser for forbruk under Innstillinger først.");
    const used = (await c.query<{ seconds: number; controls: number }>(
      `select coalesce(sum(audio_seconds) filter (where kind = 'transcription_async'), 0)::int as seconds,
              count(*) filter (where kind = 'ai_control')::int as controls
       from usage_events
       where organization_id = $1 and created_at >= ($2 || '-01')::date::timestamp at time zone 'Europe/Oslo'
         and created_at < (($2 || '-01')::date + interval '1 month')::timestamp at time zone 'Europe/Oslo'`,
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

const RECURRING = `r.id, r.organization_id as "organizationId", o.name as "organizationName", r.name, r.lines,
  r.interval_months as "intervalMonths", r.next_date::text as "nextDate", r.active, r.updated_at as "updatedAt"`;

export async function listRecurring(db: pg.Pool, session: Session) {
  return withSession(db, session, async (c) => {
    const { rows } = await c.query(
      `select ${RECURRING} from recurring_invoices r join organizations o on o.id = r.organization_id order by r.active desc, o.name, r.name`,
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
    const interval = Number(body.intervalMonths);
    if (!INTERVALS.includes(interval)) throw new BadRequest("Velg hvor ofte.");
    values.interval_months = interval;
  }
  if (body.nextDate !== undefined || creating) values.next_date = date(body.nextDate, "neste faktura");
  if (body.active !== undefined) values.active = body.active === true;
  return values;
}

export async function createRecurring(db: pg.Pool, session: Session, body: Body) {
  const org = body.organizationId;
  if (typeof org !== "string" || !isUuid(org)) throw new BadRequest("Velg callsenteret.");
  const v = recurringValues(body, true);
  return withSession(db, session, async (c) => {
    try {
      const { rows } = await c.query<{ id: string }>(
        `insert into recurring_invoices (organization_id, name, lines, interval_months, next_date, created_by)
         values ($1, $2, $3, $4, $5, app.current_user_id()) returning id`,
        [org, v.name, v.lines, v.interval_months, v.next_date],
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
    const { rowCount } = await c.query("delete from recurring_invoices where id = $1", [id]);
    if (!rowCount) throw new NotFound();
    return { ok: true };
  });
}

export async function generateRecurring(db: pg.Pool, session: Session) {
  return withSession(db, session, async (c) => {
    const { rows } = await c.query<{ n: number }>("select app.generate_recurring_invoices(current_date) as n");
    return { created: rows[0]!.n };
  });
}

// --- Overview ---------------------------------------------------------------------------------

// Key figures, excluding VAT: monthly recurring revenue from active agreements, what was invoiced
// this month and this year (credit notes subtracted), and what is outstanding and overdue.
export async function billingOverview(db: pg.Pool, session: Session) {
  return withSession(db, session, async (c) => {
    const { rows } = await c.query(
      `select
         (select coalesce(sum((l->>'quantity')::numeric * (l->>'unitPrice')::numeric / r.interval_months), 0)
          from recurring_invoices r, jsonb_array_elements(r.lines) l where r.active)::numeric(12, 2)::text as mrr,
         (select coalesce(sum(subtotal), 0) from invoices where status <> 'draft'
            and issue_date >= date_trunc('month', current_date))::text as "invoicedMonth",
         (select coalesce(sum(subtotal), 0) from invoices where status <> 'draft'
            and issue_date >= date_trunc('year', current_date))::text as "invoicedYear",
         (select coalesce(sum(i.total - coalesce((select sum(amount) from invoice_payments p where p.invoice_id = i.id), 0)), 0)
          from invoices i where i.status = 'sent' and i.kind = 'invoice')::text as outstanding,
         (select coalesce(sum(i.total - coalesce((select sum(amount) from invoice_payments p where p.invoice_id = i.id), 0)), 0)
          from invoices i where i.status = 'sent' and i.kind = 'invoice' and i.due_date < current_date)::text as overdue,
         (select count(*)::int from invoices where status = 'draft') as drafts,
         (select count(*)::int from recurring_invoices where active and next_date <= current_date) as "recurringDue"`,
    );
    return rows[0];
  });
}
