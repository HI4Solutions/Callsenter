import { randomBytes } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { api, auth, createOrg, member, owner } from "../../../packages/db/test/helpers.ts";
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

async function team(org: string, ...userIds: string[]) {
  const { rows } = await owner.query<{ id: string }>("insert into teams (organization_id, name) values ($1, 'Nord') returning id", [org]);
  for (const userId of userIds) {
    await owner.query("update memberships set team_id = $3 where organization_id = $1 and user_id = $2", [org, userId, rows[0]!.id]);
  }
}

// A call centre with an admin, a published product and a customer.
async function setup() {
  const org = await createOrg();
  const admin = await as(org, "admin");
  const product = await call(admin, "POST", "/org/products", { name: "Strøm" });
  const draft = (await call(admin, "GET", `/org/products/${product.body.id}`)).body.versions[0].id;
  await call(admin, "PATCH", `/org/products/${product.body.id}/versions/${draft}`, {
    priceMonthly: "399",
    bindingMonths: 12,
    terms: "Vilkår",
    requiredPoints: ["Opplys om angreretten"],
  });
  await call(admin, "POST", `/org/products/${product.body.id}/versions/${draft}/publish`);
  const customer = await call(admin, "POST", "/org/customers", { kind: "person", name: "Kari Kunde" });
  return { org, admin, productId: product.body.id as string, customerId: customer.body.id as string };
}

describe("sales", () => {
  it("registers a sale on the published version and moves it through the standard run", async () => {
    const s = await setup();
    const seller = await as(s.org, "seller");
    const created = await call(seller, "POST", "/org/sales", { customerId: s.customerId, productId: s.productId, note: "Ring etter 16" });
    expect(created.status).toBe(201);

    const sale = await call(seller, "GET", `/org/sales/${created.body.id}`);
    expect(sale.body).toMatchObject({
      status: "registered",
      customerName: "Kari Kunde",
      productName: "Strøm",
      templateVersion: 1,
      priceMonthly: "399.00",
      bindingMonths: 12,
      note: "Ring etter 16",
    });
    expect(sale.body.events).toHaveLength(1);

    for (const [status, statusNote] of [
      ["awaiting_confirmation", "Sendt på SMS"],
      ["confirmed", null],
      ["active", null],
    ]) {
      expect((await call(seller, "PATCH", `/org/sales/${created.body.id}`, { status, statusNote })).status).toBe(200);
    }
    const done = await call(seller, "GET", `/org/sales/${created.body.id}`);
    expect(done.body.status).toBe("active");
    expect(done.body.events.map((e: { toStatus: string; note: string | null }) => [e.toStatus, e.note])).toEqual([
      ["registered", null],
      ["awaiting_confirmation", "Sendt på SMS"],
      ["confirmed", null],
      ["active", null],
    ]);

    const back = await call(seller, "PATCH", `/org/sales/${created.body.id}`, { status: "registered" });
    expect(back.status).toBe(400);
    expect(back.body.error).toBe("Salget kan ikke få denne statusen nå. Last siden på nytt.");
    expect((await call(seller, "PATCH", `/org/sales/${created.body.id}`, { status: "active" })).body.error).toBe(
      "Salget har allerede denne statusen.",
    );
    expect((await call(seller, "PATCH", `/org/sales/${created.body.id}`, { status: "solgt" })).body.error).toBe("Ukjent status.");
  });

  it("keeps the version a sale was made on when the template changes", async () => {
    const s = await setup();
    const seller = await as(s.org, "seller");
    const first = await call(seller, "POST", "/org/sales", { customerId: s.customerId, productId: s.productId });
    const draft = await call(s.admin, "POST", `/org/products/${s.productId}/draft`);
    await call(s.admin, "PATCH", `/org/products/${s.productId}/versions/${draft.body.id}`, { priceMonthly: "449" });
    await call(s.admin, "POST", `/org/products/${s.productId}/versions/${draft.body.id}/publish`);
    const second = await call(seller, "POST", "/org/sales", { customerId: s.customerId, productId: s.productId });

    const list = await call(seller, "GET", "/org/sales", undefined, { customerId: s.customerId });
    expect(list.body.map((r: { id: string; templateVersion: number; priceMonthly: string }) => [r.id, r.templateVersion, r.priceMonthly])).toEqual([
      [second.body.id, 2, "449.00"],
      [first.body.id, 1, "399.00"],
    ]);
  });

  it("refuses sales of unpublished products and archived customers, in Norwegian", async () => {
    const s = await setup();
    const seller = await as(s.org, "seller");
    const bare = await call(s.admin, "POST", "/org/products", { name: "Uten mal" });
    const unpublished = await call(seller, "POST", "/org/sales", { customerId: s.customerId, productId: bare.body.id });
    expect(unpublished.status).toBe(400);
    expect(unpublished.body.error).toBe("Produktet har ingen publisert mal og kan ikke selges.");
    await call(s.admin, "PATCH", `/org/customers/${s.customerId}`, { archived: true });
    const archived = await call(seller, "POST", "/org/sales", { customerId: s.customerId, productId: s.productId });
    expect(archived.body.error).toBe("Fant ikke kunden, eller kunden er arkivert.");
    expect((await call(seller, "POST", "/org/sales", { productId: s.productId })).body.error).toBe("Velg en kunde.");
  });

  it("shows sellers their own sales, leaders their team's, and lets only the right people register", async () => {
    const s = await setup();
    const sellerId = await member(s.org, "seller");
    const otherId = await member(s.org, "seller");
    const leaderId = await member(s.org, "leader");
    await team(s.org, sellerId, leaderId);
    const seller = await sessionFor(sellerId, s.org);
    const other = await sessionFor(otherId, s.org);
    const leader = await sessionFor(leaderId, s.org);
    const mine = await call(seller, "POST", "/org/sales", { customerId: s.customerId, productId: s.productId });
    const theirs = await call(other, "POST", "/org/sales", { customerId: s.customerId, productId: s.productId });

    const ids = async (cookie: string, query?: Record<string, string>) =>
      (await call(cookie, "GET", "/org/sales", undefined, query)).body.map((r: { id: string }) => r.id);
    expect(await ids(seller)).toEqual([mine.body.id]);
    expect(await ids(leader)).toEqual([mine.body.id]);
    expect((await call(seller, "GET", `/org/sales/${theirs.body.id}`)).status).toBe(404);
    expect((await call(seller, "PATCH", `/org/sales/${theirs.body.id}`, { status: "cancelled" })).status).toBe(404);

    // A seller cannot register on someone else's behalf.
    const onBehalf = await call(seller, "POST", "/org/sales", { customerId: s.customerId, productId: s.productId, sellerId: otherId });
    expect(onBehalf.body.error).toBe("Du kan bare registrere dine egne salg.");

    // Compliance reads everything (with BankID) but changes nothing.
    const complianceId = await member(s.org, "compliance");
    const compliance = await sessionFor(complianceId, s.org, "bankid");
    expect((await ids(compliance)).sort()).toEqual([mine.body.id, theirs.body.id].sort());
    expect((await call(compliance, "PATCH", `/org/sales/${mine.body.id}`, { status: "cancelled" })).status).toBe(403);
    expect(await ids(compliance, { status: "cancelled" })).toEqual([]);

    // Another call centre sees none of it.
    const stranger = await as(await createOrg(), "admin");
    expect(await ids(stranger)).toEqual([]);
    expect((await call(stranger, "GET", `/org/sales/${mine.body.id}`)).status).toBe(404);
  });
});
