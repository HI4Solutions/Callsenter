import { randomBytes } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, createOrg, member, owner } from "../../../packages/db/test/helpers.ts";
import { createHandler } from "../src/api.ts";
import { sha256 } from "../src/auth/crypto.ts";
import { handleCallback } from "../src/auth/flow.ts";
import type { AuthDeps } from "../src/auth/types.ts";
import { canonicalJson, documentHash } from "../src/confirm/document.ts";
import { createFakeIdp } from "./fake-idp.ts";

const ORIGIN = "https://app.test";
let vipps: Awaited<ReturnType<typeof createFakeIdp>>;
let bankid: Awaited<ReturnType<typeof createFakeIdp>>;
let deps: AuthDeps;
let handler: ReturnType<typeof createHandler>;

beforeAll(async () => {
  vipps = await createFakeIdp({ issuer: "https://vipps.test", clientId: "vipps-client", clientSecret: "vs", userinfo: true });
  bankid = await createFakeIdp({ issuer: "https://idura.test", clientId: "idura-client", clientSecret: "is", userinfo: false });
  deps = {
    config: {
      appOrigin: ORIGIN,
      callbackBase: "https://api.test",
      providers: {
        vipps: {
          discoveryUrl: "https://vipps.test/access-management-1.0/access/.well-known/openid-configuration",
          clientId: "vipps-client",
          clientSecret: "vs",
          scope: "openid name phoneNumber",
          useUserinfo: true,
        },
        bankid: {
          discoveryUrl: "https://idura.test/.well-known/openid-configuration",
          clientId: "idura-client",
          clientSecret: "is",
          scope: "openid",
          acrValues: "urn:grn:authn:no:bankid",
          useUserinfo: false,
        },
      },
    },
    authDb: auth,
    appDb: api,
    fetch: (input, init) => (new URL(String(input)).host === "vipps.test" ? vipps : bankid).fetch(input, init),
    now: () => new Date(),
  };
  handler = createHandler({ checkDatabase: async () => true, auth: async () => deps });
});

async function sessionFor(userId: string, orgId: string) {
  const token = randomBytes(32).toString("base64url");
  await owner.query(
    `insert into sessions (id_hash, user_id, provider, active_organization_id, expires_at)
     values ($1, $2, 'vipps', $3, now() + interval '1 hour')`,
    [sha256(token), userId, orgId],
  );
  return `vq_session=${token}`;
}

async function call(cookie: string | null, method: string, rawPath: string, body?: unknown) {
  const [pathOnly, search] = rawPath.split("?");
  const response = await handler({
    rawPath: pathOnly,
    queryStringParameters: search ? Object.fromEntries(new URLSearchParams(search)) : undefined,
    requestContext: { http: { method, sourceIp: "198.51.100.7", userAgent: "vitest" } },
    headers: { origin: ORIGIN },
    cookies: cookie ? [cookie] : [],
    body: body === undefined ? undefined : JSON.stringify(body),
  } as unknown as APIGatewayProxyEventV2);
  return {
    status: response.statusCode,
    location: (response.headers as Record<string, string> | undefined)?.location,
    cookies: (response as { cookies?: string[] }).cookies ?? [],
    body: response.body ? JSON.parse(String(response.body)) : undefined,
  };
}

// A registered sale of a published product to a customer whose phone number is known.
async function setup() {
  const org = await createOrg();
  await owner.query("insert into organization_modules (organization_id, module) values ($1, 'sale_verification'), ($1, 'documentation')", [org]);
  const admin = await sessionFor(await member(org, "admin"), org);
  const product = await call(admin, "POST", "/org/products", { name: "Strøm" });
  const draft = (await call(admin, "GET", `/org/products/${product.body.id}`)).body.versions[0].id;
  await call(admin, "PATCH", `/org/products/${product.body.id}/versions/${draft}`, {
    priceMonthly: "399",
    bindingMonths: 12,
    terms: "Avtalen gjelder i 12 måneder.",
    requiredPoints: ["Angrerett"],
  });
  await call(admin, "POST", `/org/products/${product.body.id}/versions/${draft}/publish`);
  const customer = await call(admin, "POST", "/org/customers", { kind: "person", name: "Kari Kunde", phone: "91234567" });
  const seller = await sessionFor(await member(org, "seller"), org);
  const sale = await call(seller, "POST", "/org/sales", { customerId: customer.body.id, productId: product.body.id });
  return { org, seller, saleId: sale.body.id as string };
}

async function send(s: Awaited<ReturnType<typeof setup>>) {
  const created = await call(s.seller, "POST", `/org/sales/${s.saleId}/confirmations`);
  expect(created.status).toBe(201);
  return { ...created.body, token: new URL(created.body.url).hash.slice(1) };
}

describe("sale confirmations", () => {
  it("sends the offer, shows it to the customer and records acceptance with Vipps", async () => {
    const s = await setup();
    const c = await send(s);
    expect(c.url).toMatch(/^https:\/\/app\.test\/bekreft#[A-Za-z0-9_-]{43}$/);
    expect((await call(s.seller, "GET", `/org/sales/${s.saleId}`)).body.status).toBe("awaiting_confirmation");

    const view = await call(null, "GET", `/confirm?t=${c.token}`);
    expect(view.body).toMatchObject({ status: "pending", document: { product: { name: "Strøm" }, price: { monthly: "399.00" }, bindingMonths: 12 } });
    expect(view.body.documentHash).toBe(documentHash(view.body.document));

    const start = await call(null, "GET", `/confirm/vipps/start?t=${c.token}`);
    expect(start.status).toBe(302);
    const binding = start.cookies[0]!.split(";")[0]!.split("=")[1]!;
    const query = vipps.approve(start.location!, { sub: "kari-sub", name: "Kari Kunde", phone: "4791234567" });
    const result = await handleCallback(deps, "vipps", query, { ip: "198.51.100.7", userAgent: "vitest", confirmBinding: binding });
    expect(result.location).toBe(`${ORIGIN}/bekreft/ferdig?resultat=godtatt`);
    // A customer is not a user: no session.
    expect(result.sessionToken).toBeUndefined();

    const sale = await call(s.seller, "GET", `/org/sales/${s.saleId}`);
    expect(sale.body.status).toBe("confirmed");
    expect(sale.body.confirmations[0]).toMatchObject({
      status: "accepted",
      method: "vipps",
      identityName: "Kari Kunde",
      identityPhone: "+4791234567",
      identityMatch: "phone",
      ip: "198.51.100.7",
    });
    expect((await call(null, "GET", `/confirm?t=${c.token}`)).body.status).toBe("accepted");
  });

  it("lets the customer decline, and a new link replaces the old one", async () => {
    const s = await setup();
    const first = await send(s);
    const second = await send(s);
    expect((await call(null, "GET", `/confirm?t=${first.token}`)).body.status).toBe("revoked");
    const declined = await call(null, "POST", "/confirm/reject", { token: second.token });
    expect(declined.body.result).toBe("avslatt");
    expect((await call(s.seller, "GET", `/org/sales/${s.saleId}`)).body.status).toBe("rejected");
    expect((await call(s.seller, "POST", `/org/sales/${s.saleId}/confirmations`)).body.error).toBe(
      "Salget kan ikke sendes til bekreftelse nå.",
    );
  });

  it("returns to the customer's page when identification is cancelled, and refuses unknown links", async () => {
    const s = await setup();
    const c = await send(s);
    const start = await call(null, "GET", `/confirm/bankid/start?t=${c.token}`);
    const state = new URL(start.location!).searchParams.get("state")!;
    const cancelled = await handleCallback(deps, "bankid", { state, error: "access_denied" }, {});
    expect(cancelled.location).toBe(`${ORIGIN}/bekreft/ferdig?resultat=avbrutt`);
    expect((await call(null, "GET", `/confirm?t=${"x".repeat(43)}`)).status).toBe(404);
    expect((await call(null, "GET", "/confirm?t=short")).status).toBe(404);
  });

  it("accepts only in the browser that opened the offer", async () => {
    const s = await setup();
    const c = await send(s);
    const start = await call(null, "GET", `/confirm/bankid/start?t=${c.token}`);
    // The BankID link passed on to someone else: no cookie from the start.
    const query = bankid.approve(start.location!, { sub: "someone", name: "Kari Kunde" });
    const result = await handleCallback(deps, "bankid", query, {});
    expect(result.location).toBe(`${ORIGIN}/bekreft/ferdig?resultat=annen_nettleser`);
    expect((await call(null, "GET", `/confirm?t=${c.token}`)).body.status).toBe("pending");
  });

  it("stops an open link when the sale is cancelled, and shows only the status afterwards", async () => {
    const s = await setup();
    const c = await send(s);
    const cancelled = await call(s.seller, "PATCH", `/org/sales/${s.saleId}`, { status: "cancelled" });
    expect(cancelled.status).toBe(200);
    const view = await call(null, "GET", `/confirm?t=${c.token}`);
    expect(view.body).toMatchObject({ status: "revoked", document: null });
    const start = await call(null, "GET", `/confirm/vipps/start?t=${c.token}`);
    expect(start.location).toBe(`${ORIGIN}/bekreft/ferdig?resultat=trukket`);
    expect((await call(null, "POST", "/confirm/reject", { token: c.token })).body.result).toBe("trukket");
  });

  it("is closed when the module is off", async () => {
    const s = await setup();
    await owner.query("update organization_modules set enabled = false where organization_id = $1 and module = 'sale_verification'", [s.org]);
    const refused = await call(s.seller, "POST", `/org/sales/${s.saleId}/confirmations`);
    expect(refused).toMatchObject({ status: 403, body: { code: "modul_av" } });
  });

  it("keeps the document hash stable", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { f: 2, e: 3 }], c: null } })).toBe('{"a":{"c":null,"d":[1,{"e":3,"f":2}]},"b":1}');
  });
});
