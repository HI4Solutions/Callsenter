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

async function sessionFor(userId: string, provider: Provider = "bankid") {
  const token = randomBytes(32).toString("base64url");
  await owner.query(
    `insert into sessions (id_hash, user_id, provider, created_at, last_seen_at, expires_at, ip)
     values ($1, $2, $3, now(), now(), now() + interval '1 hour', '10.0.0.1')`,
    [sha256(token), userId, provider],
  );
  return `vq_session=${token}`;
}

async function superadmin(name = "Super Admin") {
  const userId = await createUser(name);
  await makePlatformAdmin(userId);
  return { userId, cookie: await sessionFor(userId) };
}

async function call(cookie: string, method: string, rawPath: string, body?: unknown, query?: Record<string, string>) {
  const response = await handler({
    rawPath,
    requestContext: { http: { method, sourceIp: "127.0.0.1", userAgent: "vitest" } },
    headers: { origin: ORIGIN },
    cookies: [cookie],
    queryStringParameters: query,
    body: body === undefined ? undefined : JSON.stringify(body),
  } as unknown as APIGatewayProxyEventV2);
  return { status: response.statusCode, body: response.body ? JSON.parse(String(response.body)) : undefined };
}

const unique = () => randomBytes(4).toString("hex");

describe("superadmin API: users", () => {
  it("finds users across call centres with their memberships", async () => {
    const { cookie } = await superadmin();
    const name = `Søkbar ${unique()}`;
    const org = await createOrg(`Org ${unique()}`);
    const userId = await member(org, "leader");
    await owner.query("update users set full_name = $2 where id = $1", [userId, name]);

    const list = await call(cookie, "GET", "/admin/users", undefined, { q: name });
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id: userId, name, platformAdmin: false });
    expect(list.body[0].organizations).toMatchObject([{ id: org, role: "Leder", status: "active" }]);
  });

  it("shows details: login methods, active sessions and recent logins", async () => {
    const { cookie } = await superadmin();
    const userId = await createUser("Detalj");
    await owner.query("insert into identities (user_id, provider, subject) values ($1, 'vipps', $2)", [userId, unique()]);
    await sessionFor(userId, "vipps");
    await owner.query("insert into login_events (provider, result, user_id, ip) values ('vipps', 'success', $1, '10.0.0.2')", [
      userId,
    ]);

    const detail = await call(cookie, "GET", `/admin/users/${userId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.identities).toMatchObject([{ provider: "vipps" }]);
    expect(detail.body.sessions).toMatchObject([{ provider: "vipps", ip: "10.0.0.1" }]);
    expect(detail.body.logins).toMatchObject([{ provider: "vipps", result: "success", ip: "10.0.0.2" }]);
    expect(detail.body.identities[0]).not.toHaveProperty("subject");
  });

  it("edits, disables (signing out) and enables a user", async () => {
    const { cookie, userId: me } = await superadmin();
    const userId = await createUser("Gammelt Navn");
    const userCookie = await sessionFor(userId);

    expect((await call(cookie, "PATCH", `/admin/users/${userId}`, { fullName: "Nytt Navn", phone: "41234567" })).status).toBe(200);
    expect((await call(cookie, "PATCH", `/admin/users/${userId}`, { access: "disabled" })).status).toBe(200);
    const after = await owner.query("select full_name, phone, status from users where id = $1", [userId]);
    expect(after.rows[0]).toMatchObject({ full_name: "Nytt Navn", phone: "+4741234567", status: "disabled" });
    expect((await call(userCookie, "GET", "/me")).status).toBe(401);

    await call(cookie, "PATCH", `/admin/users/${userId}`, { access: "enabled" });
    expect((await owner.query("select status from users where id = $1", [userId])).rows[0].status).toBe("invited");

    const self = await call(cookie, "PATCH", `/admin/users/${me}`, { access: "disabled" });
    expect(self.body.error).toBe("Du kan ikke deaktivere deg selv.");
    expect((await call(cookie, "PATCH", `/admin/users/${userId}`, { fullName: "" })).status).toBe(400);
  });

  it("signs a user out everywhere and removes a login method", async () => {
    const { cookie } = await superadmin();
    const userId = await createUser("Utlogget");
    const userCookie = await sessionFor(userId);
    await owner.query("insert into identities (user_id, provider, subject) values ($1, 'bankid', $2)", [userId, unique()]);

    const out = await call(cookie, "POST", `/admin/users/${userId}/logout`);
    expect(out.body.revoked).toBe(1);
    expect((await call(userCookie, "GET", "/me")).status).toBe(401);

    expect((await call(cookie, "DELETE", `/admin/users/${userId}/identities/bankid`)).status).toBe(200);
    expect((await call(cookie, "DELETE", `/admin/users/${userId}/identities/bankid`)).status).toBe(404);
  });

  it("grants and revokes superadmin, never your own", async () => {
    const { cookie, userId: me } = await superadmin();
    const other = await createUser("Kollega");
    expect((await call(cookie, "PUT", `/admin/users/${other}/superadmin`, { enabled: true })).status).toBe(200);
    expect((await call(cookie, "GET", `/admin/users/${other}`)).body.platformAdmin).toBe(true);
    expect((await call(cookie, "PUT", `/admin/users/${other}/superadmin`, { enabled: false })).status).toBe(200);
    expect((await call(cookie, "GET", `/admin/users/${other}`)).body.platformAdmin).toBe(false);

    expect((await call(cookie, "DELETE", `/admin/users/${me}/identities/bankid`)).status).toBe(400);
    const own = await call(cookie, "PUT", `/admin/users/${me}/superadmin`, { enabled: false });
    expect(own.status).toBe(400);
    expect(own.body.error).toBe("Du kan ikke fjerne din egen superadmin-tilgang.");
  });

  it("is closed to call centre admins", async () => {
    const org = await createOrg();
    const admin = await member(org, "admin");
    expect((await call(await sessionFor(admin), "GET", "/admin/users")).status).toBe(403);
  });
});

describe("superadmin API: catalog", () => {
  it("lists permissions, default roles and module usage", async () => {
    const { cookie } = await superadmin();
    const created = await call(cookie, "POST", "/admin/organizations", { name: "Modul AS", modules: { complaints: true } });
    expect(created.status).toBe(201);
    const res = await call(cookie, "GET", "/admin/catalog");
    expect(res.status).toBe(200);
    expect(res.body.permissions.find((p: { key: string }) => p.key === "audit.read")).toMatchObject({ requiresBankId: true });
    expect(res.body.defaultRoles.map((r: { key: string }) => r.key).sort()).toEqual(["admin", "compliance", "leader", "seller"]);
    expect(res.body.modules.find((m: { key: string }) => m.key === "complaints").enabledIn).toBeGreaterThanOrEqual(1);
  });
});
