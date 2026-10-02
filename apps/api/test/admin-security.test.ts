import { randomBytes } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { afterEach, describe, expect, it } from "vitest";
import { api, auth, createOrg, createUser, makePlatformAdmin, member, owner } from "../../../packages/db/test/helpers.ts";
import { createHandler } from "../src/api.ts";
import { clearBlocklistCache } from "../src/blocklist.ts";
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

afterEach(async () => {
  await owner.query("update blocked_ips set removed_at = now() where removed_at is null and network <<= '192.0.2.0/24'");
  clearBlocklistCache();
});

async function superadmin() {
  const userId = await createUser("Sikker Admin");
  await makePlatformAdmin(userId);
  const token = randomBytes(32).toString("base64url");
  await owner.query(
    `insert into sessions (id_hash, user_id, provider, expires_at) values ($1, $2, 'bankid', now() + interval '1 hour')`,
    [sha256(token), userId],
  );
  return { userId, cookie: `vq_session=${token}` };
}

async function call(cookie: string, method: string, rawPath: string, options: { body?: unknown; query?: Record<string, string>; ip?: string } = {}) {
  const response = await handler({
    rawPath,
    requestContext: { http: { method, sourceIp: options.ip ?? "127.0.0.1", userAgent: "vitest" } },
    headers: { origin: ORIGIN },
    cookies: [cookie],
    queryStringParameters: options.query,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  } as unknown as APIGatewayProxyEventV2);
  return { status: response.statusCode, body: response.body ? JSON.parse(String(response.body)) : undefined };
}

describe("superadmin API: security overview", () => {
  it("summarises failed logins by IP and by user", async () => {
    const { cookie } = await superadmin();
    const user = await createUser("Feiler Mye");
    const ip = `192.0.2.${10 + (randomBytes(1)[0]! % 200)}`;
    for (let i = 0; i < 3; i++) {
      await owner.query("insert into login_events (provider, result, user_id, ip) values ('vipps', 'invalid', $1, $2)", [user, ip]);
    }
    const res = await call(cookie, "GET", "/admin/security/overview", { query: { hours: "24" } });
    expect(res.status).toBe(200);
    expect(res.body.failedByIp.find((r: { ip: string }) => r.ip === ip)).toMatchObject({ failures: 3, users: 1, blocked: false });
    expect(res.body.failedByUser.find((r: { id: string }) => r.id === user)).toMatchObject({ failures: 3 });
    expect(res.body.totals.failed).toBeGreaterThanOrEqual(3);
  });
});

describe("superadmin API: audit and access logs", () => {
  it("filters the audit log and pages through it", async () => {
    const { cookie } = await superadmin();
    const created = await call(cookie, "POST", "/admin/organizations", { body: { name: "Loggført AS" } });
    const org = created.body.id;
    await call(cookie, "PATCH", `/admin/organizations/${org}`, { body: { note: "Endret" } });

    const res = await call(cookie, "GET", "/admin/security/audit", { query: { org, table: "organizations" } });
    expect(res.status).toBe(200);
    expect(res.body.rows.map((r: { action: string }) => r.action)).toEqual(["update", "insert"]);
    expect(res.body.rows[0]).toMatchObject({ organizationName: "Loggført AS", actorName: "Sikker Admin", asPlatformAdmin: true });
    expect(res.body.rows[0].newData.note).toBe("Endret");

    const page = await call(cookie, "GET", "/admin/security/audit", { query: { org, before: res.body.rows[0].id } });
    expect(page.body.rows.every((r: { id: string }) => Number(r.id) < Number(res.body.rows[0].id))).toBe(true);
    expect((await call(cookie, "GET", "/admin/security/audit", { query: { action: "drop" } })).status).toBe(400);
    expect((await call(cookie, "GET", "/admin/security/audit", { query: { from: "i går" } })).status).toBe(400);
  });

  it("shows the access log across call centres", async () => {
    const { cookie } = await superadmin();
    const org = await createOrg("Tilgang AS");
    const reader = await member(org, "compliance");
    await owner.query(
      "insert into access_log (organization_id, user_id, resource_type, resource_id, action) values ($1, $2, 'call', 'c1', 'play')",
      [org, reader],
    );
    const res = await call(cookie, "GET", "/admin/security/access", { query: { org } });
    expect(res.body.rows).toMatchObject([{ organizationName: "Tilgang AS", action: "play", resourceId: "c1" }]);
  });
});

describe("superadmin API: blocked IP addresses", () => {
  it("blocks an address for every route except /health, and unblocks it", async () => {
    const { cookie } = await superadmin();
    const blocked = await call(cookie, "POST", "/admin/security/blocked-ips", { body: { network: "192.0.2.7", reason: "Gjetting" } });
    expect(blocked.status).toBe(201);
    expect(blocked.body.network).toBe("192.0.2.7/32");

    const fromThere = await call(cookie, "GET", "/me", { ip: "192.0.2.7" });
    expect(fromThere.status).toBe(403);
    expect(fromThere.body.error).toBe("Tilgangen er sperret.");
    expect((await call(cookie, "GET", "/health", { ip: "192.0.2.7" })).status).toBe(200);

    const list = await call(cookie, "GET", "/admin/security/blocked-ips");
    expect(list.body.find((b: { id: string }) => b.id === blocked.body.id)).toMatchObject({ reason: "Gjetting", createdByName: "Sikker Admin" });
    expect((await call(cookie, "POST", "/admin/security/blocked-ips", { body: { network: "192.0.2.7" } })).status).toBe(409);

    expect((await call(cookie, "DELETE", `/admin/security/blocked-ips/${blocked.body.id}`)).status).toBe(200);
    clearBlocklistCache();
    expect((await call(cookie, "GET", "/me", { ip: "192.0.2.7" })).status).toBe(200);
  });

  it("refuses bad addresses, past expiry and your own address", async () => {
    const { cookie } = await superadmin();
    const post = (body: unknown) => call(cookie, "POST", "/admin/security/blocked-ips", { body, ip: "192.0.2.50" });
    expect((await post({ network: "not-an-ip" })).body.error).toBe("Ugyldig IP-adresse eller nettverk.");
    expect((await post({ network: "192.0.2.9", expiresAt: "2020-01-01" })).body.error).toBe("Utløpsdatoen må være fram i tid.");
    expect((await post({ network: "192.0.2.0/24" })).body.error).toBe("Du kan ikke sperre din egen IP-adresse.");
  });

  it("is closed to call centre admins", async () => {
    const org = await createOrg();
    const admin = await member(org, "admin");
    const token = randomBytes(32).toString("base64url");
    await owner.query(
      `insert into sessions (id_hash, user_id, provider, expires_at) values ($1, $2, 'bankid', now() + interval '1 hour')`,
      [sha256(token), admin],
    );
    expect((await call(`vq_session=${token}`, "GET", "/admin/security/audit")).status).toBe(403);
  });
});
