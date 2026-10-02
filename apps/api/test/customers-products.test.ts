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

const orgNumber = () => String(100_000_000 + (randomBytes(4).readUInt32BE() % 900_000_000));

describe("customers", () => {
  it("lets sellers create, find and update customers in their own call centre only", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const seller = await as(orgA, "seller");

    const person = await call(seller, "POST", "/org/customers", {
      kind: "person",
      name: "Kari Kunde",
      birthDate: "1980-05-17",
      phone: "912 34 567",
      postalCode: "0150",
      city: "Oslo",
    });
    expect(person.status).toBe(201);
    const number = orgNumber();
    const business = await call(seller, "POST", "/org/customers", {
      kind: "business",
      name: "Kunde AS",
      orgNumber: `${number.slice(0, 3)} ${number.slice(3, 6)} ${number.slice(6)}`,
      contactName: "Per Kontakt",
    });
    expect(business.status).toBe(201);

    const found = await call(seller, "GET", "/org/customers", undefined, { q: "kari" });
    expect(found.body.map((c: { name: string }) => c.name)).toEqual(["Kari Kunde"]);
    expect(found.body[0].phone).toBe("+4791234567");
    const byNumber = await call(seller, "GET", "/org/customers", undefined, { q: number });
    expect(byNumber.body.map((c: { id: string }) => c.id)).toEqual([business.body.id]);

    const updated = await call(seller, "PATCH", `/org/customers/${person.body.id}`, { email: "kari@example.com", city: null });
    expect(updated.status).toBe(200);
    const detail = await call(seller, "GET", `/org/customers/${person.body.id}`);
    expect(detail.body).toMatchObject({ kind: "person", email: "kari@example.com", city: null, birthDate: expect.any(String) });

    const other = await as(orgB, "seller");
    expect((await call(other, "GET", `/org/customers/${person.body.id}`)).status).toBe(404);
    expect((await call(other, "GET", "/org/customers")).body).toEqual([]);
    expect((await call(other, "PATCH", `/org/customers/${person.body.id}`, { name: "Kapret" })).status).toBe(404);
  });

  it("archives customers and hides them from the default list", async () => {
    const org = await createOrg();
    const seller = await as(org, "seller");
    const { body } = await call(seller, "POST", "/org/customers", { kind: "person", name: "Gammel Kunde" });
    await call(seller, "PATCH", `/org/customers/${body.id}`, { archived: true });
    expect((await call(seller, "GET", "/org/customers")).body).toEqual([]);
    expect((await call(seller, "GET", "/org/customers", undefined, { archived: "1" })).body).toHaveLength(1);
  });

  it("rejects bad input with Norwegian messages", async () => {
    const org = await createOrg();
    const seller = await as(org, "seller");
    const post = (body: unknown) => call(seller, "POST", "/org/customers", body);
    expect((await post({ name: "Uten type" })).body.error).toBe("Velg privatperson eller bedrift.");
    expect((await post({ kind: "person" })).body.error).toBe("Navn må fylles ut.");
    expect((await post({ kind: "person", name: "A", orgNumber: "123456789" })).body.error).toBe(
      "En privatperson har ikke organisasjonsnummer.",
    );
    expect((await post({ kind: "business", name: "A AS", birthDate: "1980-01-01" })).body.error).toBe(
      "En bedrift har ikke fødselsdato.",
    );
    expect((await post({ kind: "person", name: "A", birthDate: "2001-02-30" })).body.error).toBe("Ugyldig fødselsdato.");
    expect((await post({ kind: "person", name: "A", birthDate: "2999-01-01" })).body.error).toBe("Ugyldig fødselsdato.");
    expect((await post({ kind: "person", name: "A", postalCode: "123" })).body.error).toBe("Postnummeret må ha fire siffer.");
    expect((await post({ kind: "business", name: "A AS", orgNumber: "12345" })).body.error).toBe(
      "Organisasjonsnummeret må ha ni siffer.",
    );

    const number = orgNumber();
    expect((await post({ kind: "business", name: "B AS", orgNumber: number })).status).toBe(201);
    const duplicate = await post({ kind: "business", name: "B AS kopi", orgNumber: number });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe("Det finnes allerede en kunde med dette organisasjonsnummeret.");
  });

  it("needs customers.read to read and customers.manage to write", async () => {
    const org = await createOrg();
    const compliance = await as(org, "compliance"); // customers.read, not customers.manage
    expect((await call(compliance, "GET", "/org/customers")).status).toBe(200);
    const denied = await call(compliance, "POST", "/org/customers", { kind: "person", name: "Nei" });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("ingen_tilgang");
  });
});

async function product(cookie: string, name = `Strøm ${randomBytes(3).toString("hex")}`) {
  const created = await call(cookie, "POST", "/org/products", { name, description: "Fastpris" });
  expect(created.status).toBe(201);
  const detail = await call(cookie, "GET", `/org/products/${created.body.id}`);
  return { id: created.body.id as string, draftId: detail.body.versions[0].id as string };
}

const COMPLETE = {
  priceMonthly: "399,50",
  bindingMonths: 12,
  noticeMonths: 1,
  withdrawalDays: 14,
  terms: "Avtalen gjelder i 12 måneder.",
  requiredPoints: ["Si navnet på selskapet", { text: "Opplys om angreretten" }],
  approvedPhrases: ["fast pris i ett år"],
  forbiddenPhrases: ["gratis", "gratis", " "],
};

describe("products and templates", () => {
  it("creates a product with a draft, publishes it and freezes the published version", async () => {
    const org = await createOrg();
    const admin = await as(org, "admin");
    const { id, draftId } = await product(admin);

    const edited = await call(admin, "PATCH", `/org/products/${id}/versions/${draftId}`, COMPLETE);
    expect(edited.status).toBe(200);
    const draft = (await call(admin, "GET", `/org/products/${id}`)).body.versions[0];
    expect(draft).toMatchObject({
      version: 1,
      status: "draft",
      priceMonthly: "399.50",
      priceOnce: null,
      bindingMonths: 12,
      approvedPhrases: ["fast pris i ett år"],
      forbiddenPhrases: ["gratis"],
    });
    expect(draft.requiredPoints).toHaveLength(2);
    expect(draft.requiredPoints[0].id).toMatch(/^[a-f0-9]{12}$/);

    expect((await call(admin, "POST", `/org/products/${id}/versions/${draftId}/publish`)).status).toBe(200);
    const published = (await call(admin, "GET", `/org/products/${id}`)).body.versions[0];
    expect(published).toMatchObject({ status: "published", publishedByName: expect.any(String) });

    const change = await call(admin, "PATCH", `/org/products/${id}/versions/${draftId}`, { priceMonthly: "1" });
    expect(change.status).toBe(400);
    expect(change.body.error).toBe("Bare utkast kan endres. Lag et nytt utkast for å endre malen.");
    expect((await call(admin, "DELETE", `/org/products/${id}/versions/${draftId}`)).status).toBe(404);

    const list = await call(admin, "GET", "/org/products");
    expect(list.body[0]).toMatchObject({ id, publishedVersion: 1, priceMonthly: "399.50", draftVersion: null });
  });

  it("copies the newest version into a new draft and retires the old one on publish", async () => {
    const org = await createOrg();
    const admin = await as(org, "admin");
    const { id, draftId } = await product(admin);
    await call(admin, "PATCH", `/org/products/${id}/versions/${draftId}`, COMPLETE);
    await call(admin, "POST", `/org/products/${id}/versions/${draftId}/publish`);

    const next = await call(admin, "POST", `/org/products/${id}/draft`);
    expect(next.status).toBe(201);
    expect((await call(admin, "POST", `/org/products/${id}/draft`)).body.error).toBe("Produktet har allerede et utkast.");
    const before = (await call(admin, "GET", `/org/products/${id}`)).body.versions;
    expect(before[0]).toMatchObject({ version: 2, status: "draft", priceMonthly: "399.50", terms: COMPLETE.terms });
    // Points keep their ids in the copy, so findings stay linked to the same point.
    expect(before[0].requiredPoints).toEqual(before[1].requiredPoints);

    await call(admin, "PATCH", `/org/products/${id}/versions/${next.body.id}`, { priceMonthly: "449" });
    await call(admin, "POST", `/org/products/${id}/versions/${next.body.id}/publish`);
    const after = (await call(admin, "GET", `/org/products/${id}`)).body.versions;
    expect(after.map((v: { version: number; status: string; priceMonthly: string }) => [v.version, v.status, v.priceMonthly])).toEqual([
      [2, "published", "449.00"],
      [1, "retired", "399.50"],
    ]);
  });

  it("refuses to publish an incomplete draft and lets drafts be deleted", async () => {
    const org = await createOrg();
    const admin = await as(org, "admin");
    const { id, draftId } = await product(admin);
    const res = await call(admin, "POST", `/org/products/${id}/versions/${draftId}/publish`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Fyll ut før publisering: pris (engangs eller per måned), vilkår, minst ett obligatorisk punkt.");

    await call(admin, "PATCH", `/org/products/${id}/versions/${draftId}`, { terms: "Noe" });
    await call(admin, "PATCH", `/org/products/${id}/versions/${draftId}`, { terms: "" });
    expect((await call(admin, "GET", `/org/products/${id}`)).body.versions[0].terms).toBe("");

    expect((await call(admin, "PATCH", `/org/products/${id}/versions/${draftId}`, { priceOnce: "12,345" })).status).toBe(400);
    expect((await call(admin, "PATCH", `/org/products/${id}/versions/${draftId}`, { bindingMonths: 121 })).status).toBe(400);

    expect((await call(admin, "DELETE", `/org/products/${id}/versions/${draftId}`)).status).toBe(200);
    expect((await call(admin, "GET", `/org/products/${id}`)).body.versions).toEqual([]);
  });

  it("refuses duplicate names, and archiving frees the name", async () => {
    const org = await createOrg();
    const admin = await as(org, "admin");
    const { id } = await product(admin, "Mobilabonnement");
    const duplicate = await call(admin, "POST", "/org/products", { name: "mobilabonnement" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe("Det finnes allerede et produkt med dette navnet.");
    await call(admin, "PATCH", `/org/products/${id}`, { archived: true });
    expect((await call(admin, "POST", "/org/products", { name: "Mobilabonnement" })).status).toBe(201);
    expect((await call(admin, "GET", "/org/products")).body).toHaveLength(1);
    expect((await call(admin, "GET", "/org/products", undefined, { archived: "1" })).body).toHaveLength(2);
  });

  it("shows sellers products and published versions, but not drafts, and keeps writes for products.manage", async () => {
    const org = await createOrg();
    const admin = await as(org, "admin");
    const { id, draftId } = await product(admin);
    await call(admin, "PATCH", `/org/products/${id}/versions/${draftId}`, COMPLETE);
    await call(admin, "POST", `/org/products/${id}/versions/${draftId}/publish`);
    await call(admin, "POST", `/org/products/${id}/draft`);

    const seller = await as(org, "seller");
    expect((await call(seller, "GET", "/org/products")).body).toHaveLength(1);
    const detail = await call(seller, "GET", `/org/products/${id}`);
    expect(detail.body.versions.map((v: { status: string }) => v.status)).toEqual(["published"]);
    expect((await call(seller, "POST", "/org/products", { name: "Nei" })).status).toBe(403);
    expect((await call(seller, "PATCH", `/org/products/${id}`, { name: "Nei" })).status).toBe(403);

    const other = await as(await createOrg(), "admin");
    expect((await call(other, "GET", `/org/products/${id}`)).status).toBe(404);
    expect((await call(other, "POST", `/org/products/${id}/draft`)).status).toBe(404);
  });
});
