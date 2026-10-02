import { randomBytes } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { api, auth, createOrg, createUser, member, owner } from "../../../packages/db/test/helpers.ts";
import { createHandler } from "../src/api.ts";
import { sha256 } from "../src/auth/crypto.ts";
import type { AuthDeps } from "../src/auth/types.ts";

const ORIGIN = "https://app.test";
const deps: AuthDeps = {
  config: { appOrigin: ORIGIN, callbackBase: "https://api.test", providers: {} },
  authDb: auth,
  appDb: api,
  fetch,
  now: () => new Date(),
};
const handler = createHandler({ checkDatabase: async () => true, auth: async () => deps });

async function sessionFor(userId: string, orgId: string, provider = "vipps") {
  const token = randomBytes(32).toString("base64url");
  await owner.query(
    `insert into sessions (id_hash, user_id, provider, active_organization_id, expires_at)
     values ($1, $2, $3, $4, now() + interval '1 hour')`,
    [sha256(token), userId, provider, orgId],
  );
  return `vq_session=${token}`;
}

async function call(cookie: string, method: string, rawPath: string, body?: unknown, query?: Record<string, string>) {
  const response = await handler({
    rawPath,
    queryStringParameters: query,
    requestContext: { http: { method, sourceIp: "127.0.0.1", userAgent: "vitest" } },
    headers: { origin: ORIGIN },
    cookies: [cookie],
    body: body === undefined ? undefined : JSON.stringify(body),
  } as unknown as APIGatewayProxyEventV2);
  return { status: response.statusCode, body: response.body ? JSON.parse(String(response.body)) : undefined };
}

async function as(org: string, role: string) {
  return sessionFor(await member(org, role), org);
}


async function setup() {
  const org = await createOrg();
  const admin = await as(org, "admin");
  const product = await call(admin, "POST", "/org/products", { name: "Strøm" });
  const draft = (await call(admin, "GET", `/org/products/${product.body.id}`)).body.versions[0].id;
  await call(admin, "PATCH", `/org/products/${product.body.id}/versions/${draft}`, {
    priceMonthly: "399",
    terms: "Vilkår",
    requiredPoints: ["Angrerett"],
  });
  await call(admin, "POST", `/org/products/${product.body.id}/versions/${draft}/publish`);
  const customer = await call(admin, "POST", "/org/customers", { kind: "person", name: "Kari Kunde" });
  const seller = await as(org, "seller");
  const sale = await call(seller, "POST", "/org/sales", { customerId: customer.body.id, productId: product.body.id });
  return { org, admin, seller, customerId: customer.body.id as string, saleId: sale.body.id as string };
}

describe("sale documentation", () => {
  it("collects the sale, its history and confirmations, and logs the view", async () => {
    const s = await setup();
    await call(s.seller, "POST", `/org/sales/${s.saleId}/confirmations`);
    const doc = await call(s.seller, "GET", `/org/sales/${s.saleId}/documentation`);
    expect(doc.status).toBe(200);
    expect(doc.body.sale).toMatchObject({ productName: "Strøm", customerName: "Kari Kunde", terms: "Vilkår", templateVersion: 1 });
    expect(doc.body.events.map((e: { toStatus: string }) => e.toStatus)).toEqual(["registered", "awaiting_confirmation"]);
    expect(doc.body.confirmations).toHaveLength(1);
    expect(doc.body.calls).toEqual([]);
    const log = await owner.query("select 1 from access_log where resource_type = 'sale_documentation' and resource_id = $1", [s.saleId]);
    expect(log.rowCount).toBe(1);
    const stranger = await as(await createOrg(), "admin");
    expect((await call(stranger, "GET", `/org/sales/${s.saleId}/documentation`)).status).toBe(404);
  });
});

describe("complaints", () => {
  it("opens, documents and closes a complaint with complaints.manage", async () => {
    const s = await setup();
    const compliance = await as(s.org, "compliance");
    expect((await call(s.seller, "POST", "/org/complaints", { customerId: s.customerId, summary: "Nei" })).status).toBe(403);
    const created = await call(compliance, "POST", "/org/complaints", {
      customerId: s.customerId,
      saleId: s.saleId,
      summary: "Fikk ikke informasjon om angrerett",
      channel: "email",
    });
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await call(compliance, "PATCH", `/org/complaints/${id}`, { status: "investigating", statusNote: "Hører opptaket" })).status).toBe(200);
    expect((await call(compliance, "POST", `/org/complaints/${id}/notes`, { note: "Ringte kunden" })).status).toBe(201);
    const closing = await call(compliance, "PATCH", `/org/complaints/${id}`, { status: "resolved" });
    expect(closing.body.error).toBe("Skriv utfallet før saken lukkes.");
    expect((await call(compliance, "PATCH", `/org/complaints/${id}`, { status: "resolved", outcome: "Avtalen hevet" })).status).toBe(200);

    const detail = await call(compliance, "GET", `/org/complaints/${id}`);
    expect(detail.body).toMatchObject({ status: "resolved", outcome: "Avtalen hevet", customerName: "Kari Kunde", channel: "email" });
    expect(detail.body.events.map((e: { kind: string; toStatus: string | null }) => [e.kind, e.toStatus])).toEqual([
      ["created", "open"],
      ["status", "investigating"],
      ["note", null],
      ["status", "resolved"],
    ]);
    // A Vipps session does not see all sales (calls.read.all needs BankID); with BankID it does.
    expect(detail.body).toMatchObject({ documentation: null, documentationHidden: true });
    const strong = await sessionFor(await member(s.org, "compliance"), s.org, "bankid");
    expect((await call(strong, "GET", `/org/complaints/${id}`)).body.documentation.sale.productName).toBe("Strøm");
    expect((await call(compliance, "GET", "/org/complaints", undefined, { open: "1" })).body).toEqual([]);

    const other = await call(s.admin, "POST", "/org/customers", { kind: "person", name: "Ola" });
    const wrong = await call(compliance, "POST", "/org/complaints", { customerId: other.body.id, saleId: s.saleId, summary: "X" });
    expect(wrong.body.error).toBe("Salget tilhører en annen kunde.");
  });
});
