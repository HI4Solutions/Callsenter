import { randomBytes } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { api, auth, createOrg, createUser, makePlatformAdmin, member, owner } from "../../../packages/db/test/helpers.ts";
import { createHandler } from "../src/api.ts";
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
    expect((await call(admin.cookie, "DELETE", `/admin/invoices/${id}`)).body.error).toBe("Bare utkast kan slettes.");

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

  it("makes drafts from fixed agreements", async () => {
    const admin = await superadmin();
    const org = await createOrg();
    const made = await call(admin.cookie, "POST", "/admin/recurring-invoices", {
      organizationId: org,
      name: "Abonnement",
      lines: [{ description: "VeriQall", quantity: 1, unitPrice: 1000 }],
      intervalMonths: 3,
      nextDate: "2026-01-01",
    });
    expect(made.status).toBe(201);
    expect((await call(admin.cookie, "POST", "/admin/recurring-invoices", { organizationId: org, name: "X", lines: [], intervalMonths: 2, nextDate: "2026-01-01" })).status).toBe(400);
    const generated = await call(admin.cookie, "POST", "/admin/recurring-invoices/generate");
    expect(generated.body.created).toBeGreaterThanOrEqual(4);
    const agreements = await call(admin.cookie, "GET", "/admin/recurring-invoices");
    expect(agreements.body.find((r: { id: string }) => r.id === made.body.id).nextDate > "2026-10-01").toBe(true);
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
