import { randomBytes } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { afterEach, describe, expect, it } from "vitest";
import { api, auth, createOrg, createUser, makePlatformAdmin, member, owner, worker } from "../../../packages/db/test/helpers.ts";
import { createHandler } from "../src/api.ts";
import { type Email, setMailer } from "../src/email.ts";
import { billingDaily } from "../src/worker.ts";
import { sha256 } from "../src/auth/crypto.ts";
import type { AuthDeps, Provider } from "../src/auth/types.ts";

const ORIGIN = "https://app.test";
const deps: AuthDeps = {
  config: { appOrigin: ORIGIN, callbackBase: "https://api.test", providers: {} },
  authDb: auth,
  appDb: api,
  fetch,
  now: () => new Date(),
};
const handler = createHandler({ checkDatabase: async () => true, auth: async () => deps });

async function sessionFor(userId: string, provider: Provider = "bankid", orgId: string | null = null) {
  const token = randomBytes(32).toString("base64url");
  await owner.query(
    `insert into sessions (id_hash, user_id, provider, active_organization_id, created_at, last_seen_at, expires_at)
     values ($1, $2, $3, $4, now(), now(), now() + interval '1 hour')`,
    [sha256(token), userId, provider, orgId],
  );
  return `vq_session=${token}`;
}

async function superadmin(provider: Provider = "bankid") {
  const userId = await createUser("Super Admin");
  await makePlatformAdmin(userId);
  return { userId, cookie: await sessionFor(userId, provider) };
}

async function call(cookie: string, method: string, rawPath: string, body?: unknown, origin = ORIGIN) {
  const [pathOnly, search] = rawPath.split("?");
  const response = await handler({
    rawPath: pathOnly,
    queryStringParameters: search ? Object.fromEntries(new URLSearchParams(search)) : undefined,
    requestContext: { http: { method, sourceIp: "127.0.0.1", userAgent: "vitest" } },
    headers: { origin },
    cookies: [cookie],
    body: body === undefined ? undefined : JSON.stringify(body),
  } as unknown as APIGatewayProxyEventV2);
  return { status: response.statusCode, body: response.body ? JSON.parse(String(response.body)) : undefined };
}

describe("invoicing", () => {
  it("lets a superadmin set up, write, send, get paid for and credit invoices", async () => {
    const admin = await superadmin();
    const org = await createOrg();
    await owner.query("update organizations set invoice_email = 'faktura@example.test' where id = $1", [org]);

    const settings = await call(admin.cookie, "PATCH", "/admin/billing/settings", {
      companyName: "Leverandør AS",
      orgNumber: "999 999 999",
      accountNumber: "1234.56.78903",
      dueDays: 10,
      priceAudioHour: "120",
    });
    expect(settings.status).toBe(200);
    expect(settings.body).toMatchObject({ orgNumber: "999999999", accountNumber: "12345678903", dueDays: 10, priceAudioHour: "120.00" });
    expect((await call(admin.cookie, "PATCH", "/admin/billing/settings", { accountNumber: "123" })).status).toBe(400);

    const created = await call(admin.cookie, "POST", "/admin/invoices", {
      organizationId: org,
      lines: [{ description: "Lisens oktober", quantity: 1, unitPrice: "2 990,00" }],
    });
    expect(created.status).toBe(201);
    const id = created.body.id;
    const draft = await call(admin.cookie, "GET", `/admin/invoices/${id}`);
    expect(draft.body).toMatchObject({ status: "draft", number: null, subtotal: "2990.00", vat: "747.50", total: "3737.50" });

    // Usage for a month with audio: two hours at 120.
    await owner.query(
      "insert into usage_events (organization_id, kind, audio_seconds, created_at) values ($1, 'transcription_async', 7200, '2026-09-15T12:00:00Z')",
      [org],
    );
    const usage = await call(admin.cookie, "POST", `/admin/invoices/${id}/usage`, { month: "2026-09" });
    expect(usage.status).toBe(200);
    expect(usage.body.lines[1]).toMatchObject({ description: "Transkribering september 2026, timer lyd", quantity: "2.000", unitPrice: "120.00" });

    const sent = await call(admin.cookie, "POST", `/admin/invoices/${id}/send`);
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ status: "sent", total: "4037.50", recipient: { email: "faktura@example.test" } });
    expect(sent.body.number).toBeGreaterThan(0);
    expect((await call(admin.cookie, "PATCH", `/admin/invoices/${id}`, { note: "x" })).body.error).toMatch(/kreditnota/);
    expect((await call(admin.cookie, "DELETE", `/admin/invoices/${id}`)).body.error).toBe("Bare utkast og planlagte fakturaer kan slettes.");

    const paid = await call(admin.cookie, "POST", `/admin/invoices/${id}/payments`, { amount: "4037,50", paidOn: "2026-10-01", reference: "Bank" });
    expect(paid.body).toMatchObject({ status: "paid", paid: "4037.50" });

    const credit = await call(admin.cookie, "POST", `/admin/invoices/${id}/credit`, { reason: "Feil pris" });
    expect(credit.status).toBe(201);
    expect((await call(admin.cookie, "GET", `/admin/invoices/${credit.body.id}`)).body).toMatchObject({
      kind: "credit",
      total: "-4037.50",
      creditOfNumber: sent.body.number,
    });
    const list = await call(admin.cookie, "GET", `/admin/invoices?organizationId=${org}`);
    expect(list.body.map((i: { status: string }) => i.status).sort()).toEqual(["credited", "sent"]);
    expect((await call(admin.cookie, "GET", "/admin/billing/overview")).status).toBe(200);
  });

  it("bills transcription in pieces as the sum of the pieces, and a whole recording once", async () => {
    const admin = await superadmin();
    const org = await createOrg();
    const seller = await member(org, "seller");
    await call(admin.cookie, "PATCH", "/admin/billing/settings", { companyName: "Leverandør AS", orgNumber: "999999999", accountNumber: "12345678903", priceAudioHour: "100" });
    const newCall = async () =>
      (await owner.query("insert into calls (organization_id, user_id, source, transcription_mode) values ($1, $2, 'microphone', 'chunked') returning id", [org, seller])).rows[0].id as string;
    const event = (callId: string, seconds: number, piece: number | null) =>
      owner.query(
        "insert into usage_events (organization_id, call_id, kind, audio_seconds, piece, created_at) values ($1, $2, 'transcription_async', $3, $4, '2026-09-10T12:00:00Z')",
        [org, callId, seconds, piece],
      );
    // One hour in four pieces.
    const pieces = await newCall();
    for (const seq of [0, 1, 2, 3]) await event(pieces, 900, seq);
    // A piece transcribed twice is still one piece.
    await expect(event(pieces, 900, 3)).rejects.toThrow(/duplicate key/);
    // A piece went missing, so the whole hour was transcribed again: billed once, as the whole.
    const fallback = await newCall();
    for (const seq of [0, 1]) await event(fallback, 900, seq);
    await event(fallback, 3600, null);

    const created = await call(admin.cookie, "POST", "/admin/invoices", { organizationId: org, lines: [{ description: "Lisens", quantity: 1, unitPrice: "1" }] });
    const usage = await call(admin.cookie, "POST", `/admin/invoices/${created.body.id}/usage`, { month: "2026-09" });
    expect(usage.body.lines[1]).toMatchObject({ description: "Transkribering september 2026, timer lyd", quantity: "2.000" });
  });

  it("sends fixed agreements that are due when the run starts, and only once", async () => {
    const admin = await superadmin();
    const org = await createOrg();
    await call(admin.cookie, "PATCH", "/admin/billing/settings", { companyName: "Leverandør AS", orgNumber: "999999999", accountNumber: "12345678903" });
    const made = await call(admin.cookie, "POST", "/admin/recurring-invoices", {
      organizationId: org,
      name: "Abonnement",
      lines: [{ description: "VeriQall", quantity: 1, unitPrice: 1000 }],
      intervalMonths: 3,
      nextDate: "2026-01-01",
    });
    expect(made.status).toBe(201);
    expect((await call(admin.cookie, "POST", "/admin/recurring-invoices", { organizationId: org, name: "X", lines: [], intervalMonths: 2, nextDate: "2026-01-01" })).status).toBe(400);
    const run = await call(admin.cookie, "POST", "/admin/billing/run");
    expect(run.status).toBe(200);
    const invoices = await call(admin.cookie, "GET", `/admin/invoices?organizationId=${org}`);
    // Overdue periods are not caught up: one invoice, and the agreement moves past today.
    expect(invoices.body).toHaveLength(1);
    expect(invoices.body[0]).toMatchObject({ status: "sent", grantAccess: true, recurringId: made.body.id });
    await call(admin.cookie, "POST", "/admin/billing/run");
    expect((await call(admin.cookie, "GET", `/admin/invoices?organizationId=${org}`)).body).toHaveLength(1);
    const agreements = await call(admin.cookie, "GET", "/admin/recurring-invoices");
    const agreement = agreements.body.find((r: { id: string }) => r.id === made.body.id);
    expect(agreement.sendDate > new Date().toISOString().slice(0, 10)).toBe(true);
    await call(admin.cookie, "PATCH", `/admin/recurring-invoices/${made.body.id}`, { active: false });
    expect((await call(admin.cookie, "DELETE", `/admin/recurring-invoices/${made.body.id}`)).status).toBe(200);
  });

  it("shows the call centre its own sent invoices with billing.read in a BankID session", async () => {
    const admin = await superadmin();
    const org = await createOrg();
    const id = (await call(admin.cookie, "POST", "/admin/invoices", { organizationId: org, lines: [{ description: "Lisens", unitPrice: 100 }] })).body.id;
    await call(admin.cookie, "PATCH", "/admin/billing/settings", { companyName: "Leverandør AS", orgNumber: "999999999", accountNumber: "12345678903" });
    await call(admin.cookie, "POST", `/admin/invoices/${id}/send`);
    await call(admin.cookie, "POST", "/admin/invoices", { organizationId: org, lines: [{ description: "Utkast", unitPrice: 1 }] });

    const orgAdmin = await member(org, "admin");
    const strong = await sessionFor(orgAdmin, "bankid", org);
    const list = await call(strong, "GET", "/org/invoices");
    expect(list.body.map((i: { id: string }) => i.id)).toEqual([id]);
    expect((await call(strong, "GET", `/org/invoices/${id}`)).body).toMatchObject({ total: "125.00", lines: [{ description: "Lisens" }] });

    const weak = await sessionFor(orgAdmin, "vipps", org);
    expect((await call(weak, "GET", "/org/invoices")).body.code).toBe("krever_bankid");
    const seller = await sessionFor(await member(org, "seller"), "bankid", org);
    expect((await call(seller, "GET", "/org/invoices")).status).toBe(403);
    expect((await call(strong, "GET", "/admin/invoices")).status).toBe(403);
  });
});

describe("e-mail", () => {
  afterEach(() => setMailer(undefined));

  it("e-mails a sent invoice to the invoice address frozen on it, and logs it", async () => {
    const sent: Email[] = [];
    setMailer(async (email) => {
      sent.push(email);
      return "msg-1";
    });
    const admin = await superadmin();
    const org = await createOrg();
    await owner.query("update organizations set invoice_email = 'faktura@example.test' where id = $1", [org]);
    await call(admin.cookie, "PATCH", "/admin/billing/settings", { companyName: "Leverandør AS", orgNumber: "999999999", accountNumber: "12345678903" });
    const id = (await call(admin.cookie, "POST", "/admin/invoices", { organizationId: org, lines: [{ description: "Lisens <b>", unitPrice: 100 }] })).body.id;
    expect((await call(admin.cookie, "POST", `/admin/invoices/${id}/email`)).body.error).toMatch(/Send fakturaen/);
    await call(admin.cookie, "PATCH", "/admin/billing/settings", { copyEmail: "regnskap@example.test" });
    const sending = await call(admin.cookie, "POST", `/admin/invoices/${id}/send`);
    const number = sending.body.number;
    // Sending e-mails it at once, with the PDF and a blind copy.
    expect(sending.body).toMatchObject({ status: "sent", emailed: true, emails: [{ sentTo: "faktura@example.test" }] });
    expect(sent[0]!.bcc).toEqual(["regnskap@example.test"]);
    expect(sent[0]!.attachments?.[0]).toMatchObject({ filename: `faktura-${number}.pdf`, contentType: "application/pdf" });
    expect(Buffer.from(sent[0]!.attachments![0]!.content).subarray(0, 5).toString()).toBe("%PDF-");
    // Later changes to the call centre do not change where this invoice goes.
    await owner.query("update organizations set invoice_email = 'ny@example.test' where id = $1", [org]);

    const emailed = await call(admin.cookie, "POST", `/admin/invoices/${id}/email`);
    expect(emailed.status).toBe(200);
    expect(emailed.body.emails).toHaveLength(2);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ to: "faktura@example.test", subject: `Faktura ${number} fra Leverandør AS` });
    expect(sent[0]!.text).toContain("1234 56 78903");
    expect(sent[0]!.html).toContain("Lisens &lt;b&gt;");

    const orgAdmin = await member(org, "admin");
    const strong = await sessionFor(orgAdmin, "bankid", org);
    expect((await call(strong, "GET", `/org/invoices/${id}`)).body.emails).toEqual([]);
  });

  it("refuses to e-mail invoices when e-mail is not set up", async () => {
    setMailer(null);
    const admin = await superadmin();
    const org = await createOrg();
    const id = (await call(admin.cookie, "POST", "/admin/invoices", { organizationId: org, lines: [{ description: "Lisens", unitPrice: 1 }] })).body.id;
    expect((await call(admin.cookie, "POST", `/admin/invoices/${id}/email`)).body.error).toMatch(/ikke satt opp/);
  });

  it("e-mails the invitation link when the person has an e-mail address", async () => {
    const sent: Email[] = [];
    setMailer(async (email) => {
      sent.push(email);
      return "msg-2";
    });
    const admin = await superadmin();
    const org = await createOrg("Callsenter Nord");
    const invited = await call(admin.cookie, "POST", `/admin/organizations/${org}/invitations`, { fullName: "Kari Leder", email: "kari@example.test" });
    expect(invited.status).toBe(201);
    expect(invited.body.emailed).toBe(true);
    expect(sent[0]).toMatchObject({ to: "kari@example.test", subject: "Invitasjon til Callsenter Nord i VeriQall" });
    expect(sent[0]!.text).toContain(invited.body.link);

    setMailer(async () => {
      throw new Error("SES down");
    });
    const second = await call(admin.cookie, "POST", `/admin/organizations/${org}/invitations`, { fullName: "Ola", email: "ola@example.test" });
    expect(second.status).toBe(201);
    expect(second.body.emailed).toBe(false);
    expect(second.body.link).toMatch(/invitasjon=/);
  });
});

describe("invoicing v2", () => {
  it("manages packages, schedules invoices, makes PDFs and closes on missed payment", async () => {
    const admin = await superadmin();
    const org = await createOrg();
    await call(admin.cookie, "PATCH", "/admin/billing/settings", { companyName: "Leverandør AS", orgNumber: "999999999", accountNumber: "12345678903" });
    expect((await call(admin.cookie, "POST", "/admin/billing/packages", { name: "Pro", unitPrice: "2990", modules: ["nope"] })).status).toBe(400);
    const pkg = await call(admin.cookie, "POST", "/admin/billing/packages", { name: "Pro", unitPrice: "2990", modules: ["transcription", "ai_control"] });
    expect(pkg.status).toBe(201);
    expect(pkg.body).toMatchObject({ name: "Pro", unitPrice: "2990.00", modules: ["transcription", "ai_control"], active: true });

    // Scheduled: an invoice date in the future.
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const draft = await call(admin.cookie, "POST", "/admin/invoices", {
      organizationId: org,
      issueDate: future,
      grantAccess: true,
      lines: [{ kind: "package", packageId: pkg.body.id, description: "Pro", unitPrice: "2990" }],
    });
    const scheduled = await call(admin.cookie, "POST", `/admin/invoices/${draft.body.id}/send`);
    expect(scheduled.body).toMatchObject({ status: "scheduled", number: null, emailed: false });
    const preview = await handlerRaw(admin.cookie, `/admin/invoices/${draft.body.id}/pdf`);
    expect(preview.headers["content-type"]).toBe("application/pdf");
    expect(Buffer.from(preview.body, "base64").subarray(0, 5).toString()).toBe("%PDF-");
    expect((await call(admin.cookie, "POST", `/admin/invoices/${draft.body.id}/unschedule`)).body.status).toBe("draft");

    // Sent now: access and modules follow, and the call centre can download its PDF.
    await call(admin.cookie, "PATCH", `/admin/invoices/${draft.body.id}`, { issueDate: null });
    const sent = await call(admin.cookie, "POST", `/admin/invoices/${draft.body.id}/send`);
    expect(sent.body).toMatchObject({ status: "sent", grantAccess: true });
    expect(sent.body.periodEnd >= sent.body.periodStart).toBe(true);
    const customers = await call(admin.cookie, "GET", "/admin/billing/customers");
    const customer = customers.body.find((c: { id: string }) => c.id === org);
    expect(customer).toMatchObject({ open: true, invoices: 1, outstanding: "3737.50" });
    expect(customer.customerNumber).toBeGreaterThanOrEqual(10001);
    const strong = await sessionFor(await member(org, "admin"), "bankid", org);
    const own = await handlerRaw(strong, `/org/invoices/${draft.body.id}/pdf`);
    expect(Buffer.from(own.body, "base64").subarray(0, 5).toString()).toBe("%PDF-");

    // Payment missed by hand: closed at once.
    const missed = await call(admin.cookie, "POST", `/admin/invoices/${draft.body.id}/missed`);
    expect(missed.body.status).toBe("payment_missed");
    expect((await call(admin.cookie, "GET", "/admin/billing/customers")).body.find((c: { id: string }) => c.id === org).open).toBe(false);
    expect((await call(strong, "GET", "/org/invoices")).status).toBe(403);
  });
});

describe("morning run", () => {
  afterEach(() => setMailer(undefined));

  it("sends due agreements as the worker and e-mails them with the PDF", async () => {
    const sent: Email[] = [];
    setMailer(async (email) => {
      sent.push(email);
      return "msg";
    });
    const admin = await superadmin();
    const org = await createOrg();
    await owner.query("update organizations set invoice_email = 'kunde@example.test' where id = $1", [org]);
    await call(admin.cookie, "PATCH", "/admin/billing/settings", { companyName: "Leverandør AS", orgNumber: "999999999", accountNumber: "12345678903" });
    const today = new Date().toISOString().slice(0, 10);
    await call(admin.cookie, "POST", "/admin/recurring-invoices", {
      organizationId: org,
      name: "Abonnement",
      lines: [{ description: "VeriQall", unitPrice: 1000 }],
      nextDate: today,
    });
    const result = await billingDaily(worker);
    expect(result.sent).toBeGreaterThanOrEqual(1);
    expect(sent.some((e) => e.to === "kunde@example.test" && e.attachments?.[0]?.contentType === "application/pdf")).toBe(true);
    const invoices = await call(admin.cookie, "GET", `/admin/invoices?organizationId=${org}`);
    const detail = await call(admin.cookie, "GET", `/admin/invoices/${invoices.body[0].id}`);
    expect(detail.body.emails).toMatchObject([{ sentTo: "kunde@example.test" }]);
  });
});

async function handlerRaw(cookie: string, rawPath: string) {
  const response = await handler({
    rawPath,
    requestContext: { http: { method: "GET", sourceIp: "127.0.0.1", userAgent: "vitest" } },
    headers: { origin: ORIGIN },
    cookies: [cookie],
  } as unknown as APIGatewayProxyEventV2);
  return { status: response.statusCode, headers: (response.headers ?? {}) as Record<string, string>, body: String(response.body) };
}
