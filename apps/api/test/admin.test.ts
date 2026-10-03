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
    `insert into sessions (id_hash, user_id, provider, created_at, last_seen_at, expires_at)
     values ($1, $2, $3, now(), now(), now() + interval '1 hour')`,
    [sha256(token), userId, provider],
  );
  return `vq_session=${token}`;
}

async function superadmin(provider: Provider = "bankid") {
  const userId = await createUser("Super Admin");
  await makePlatformAdmin(userId);
  return { userId, cookie: await sessionFor(userId, provider) };
}

async function call(cookie: string, method: string, rawPath: string, body?: unknown, origin = ORIGIN) {
  const response = await handler({
    rawPath,
    requestContext: { http: { method, sourceIp: "127.0.0.1", userAgent: "vitest" } },
    headers: { origin },
    cookies: [cookie],
    body: body === undefined ? undefined : JSON.stringify(body),
  } as unknown as APIGatewayProxyEventV2);
  return { status: response.statusCode, body: response.body ? JSON.parse(String(response.body)) : undefined };
}

const orgNumber = () => String(100_000_000 + (randomBytes(4).readUInt32BE() % 899_999_999));

describe("superadmin API: access", () => {
  it("requires a session", async () => {
    expect((await call("vq_session=nope", "GET", "/admin/organizations")).status).toBe(401);
  });

  it("requires a superadmin in a BankID session", async () => {
    const vipps = await superadmin("vipps");
    const denied = await call(vipps.cookie, "GET", "/admin/organizations");
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("krever_bankid");

    const org = await createOrg();
    const admin = await member(org, "admin");
    const notSuper = await call(await sessionFor(admin), "GET", "/admin/organizations");
    expect(notSuper.status).toBe(403);
    expect(notSuper.body.code).toBe("ikke_superadmin");
  });

  it("refuses changes from another origin", async () => {
    const { cookie } = await superadmin();
    const res = await call(cookie, "POST", "/admin/organizations", { name: "X" }, "https://evil.example");
    expect(res.status).toBe(403);
  });
});

describe("superadmin API: call centres", () => {
  it("creates a call centre with details, modules and default roles", async () => {
    const { cookie } = await superadmin();
    const number = orgNumber();
    const created = await call(cookie, "POST", "/admin/organizations", {
      name: "  Salg AS ",
      orgNumber: `${number.slice(0, 3)} ${number.slice(3, 6)} ${number.slice(6)}`,
      contactName: "Ola Kontakt",
      contactEmail: "ola@salg.example",
      contactPhone: "912 34 567",
      invoiceEmail: "faktura@salg.example",
      trialEndsAt: "2030-01-31",
      modules: { sales: true, transcription: true, complaints: false },
    });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const detail = await call(cookie, "GET", `/admin/organizations/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      name: "Salg AS",
      orgNumber: number,
      contactPhone: "+4791234567",
      status: "active",
    });
    const enabled = detail.body.modules.filter((m: { enabled: boolean }) => m.enabled).map((m: { key: string }) => m.key);
    expect(enabled.sort()).toEqual(["sales", "transcription"]);
    expect(detail.body.roles.map((r: { key: string }) => r.key).sort()).toEqual(["admin", "compliance", "leader", "seller"]);

    const list = await call(cookie, "GET", "/admin/organizations");
    expect(list.body.some((o: { id: string }) => o.id === id)).toBe(true);

    // Changes are audited as a superadmin action in that call centre.
    const audit = await owner.query(
      "select action, as_platform_admin from audit_log where organization_id = $1 and table_name = 'organizations'",
      [id],
    );
    expect(audit.rows).toEqual([{ action: "insert", as_platform_admin: true }]);
  });

  it("validates input in Norwegian", async () => {
    const { cookie } = await superadmin();
    expect((await call(cookie, "POST", "/admin/organizations", {})).body.error).toBe("Navn må fylles ut.");
    expect((await call(cookie, "POST", "/admin/organizations", { name: "A", orgNumber: "123" })).body.error).toBe(
      "Organisasjonsnummeret må ha ni siffer.",
    );
    expect((await call(cookie, "POST", "/admin/organizations", { name: "A", modules: { nope: true } })).status).toBe(400);
    const number = orgNumber();
    await call(cookie, "POST", "/admin/organizations", { name: "A", orgNumber: number });
    const dup = await call(cookie, "POST", "/admin/organizations", { name: "B", orgNumber: number });
    expect(dup.status).toBe(409);
  });

  it("updates details, status and modules", async () => {
    const { cookie } = await superadmin();
    const { body } = await call(cookie, "POST", "/admin/organizations", { name: "Endre AS" });
    const res = await call(cookie, "PATCH", `/admin/organizations/${body.id}`, {
      status: "suspended",
      note: "Betaler ikke",
      modules: { dashboard: true },
    });
    expect(res.status).toBe(200);
    const detail = await call(cookie, "GET", `/admin/organizations/${body.id}`);
    expect(detail.body).toMatchObject({ status: "suspended", note: "Betaler ikke" });
    expect(detail.body.modules.find((m: { key: string }) => m.key === "dashboard").enabled).toBe(true);
    expect((await call(cookie, "PATCH", `/admin/organizations/${body.id}`, { status: "deleted" })).status).toBe(400);
    expect((await call(cookie, "PATCH", `/admin/organizations/${body.id}`, { name: "" })).status).toBe(400);
  });

  it("locks members out of suspended call centres and expired trials, but not superadmins", async () => {
    const { cookie } = await superadmin();
    const { body } = await call(cookie, "POST", "/admin/organizations", { name: "Prøve AS" });
    const admin = await member(body.id, "admin");
    const orgOf = async () => {
      const client = await api.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('app.current_user_id', $1, true), set_config('app.current_org_id', $2, true)", [
          admin,
          body.id,
        ]);
        const { rows } = await client.query("select app.current_org_id() as org");
        await client.query("rollback");
        return rows[0].org;
      } finally {
        client.release();
      }
    };
    expect(await orgOf()).toBe(body.id);
    await call(cookie, "PATCH", `/admin/organizations/${body.id}`, { trialEndsAt: "2020-01-01" });
    expect(await orgOf()).toBeNull();
    await call(cookie, "PATCH", `/admin/organizations/${body.id}`, { trialEndsAt: null, status: "suspended" });
    expect(await orgOf()).toBeNull();
    // The superadmin still sees it.
    expect((await call(cookie, "GET", `/admin/organizations/${body.id}`)).status).toBe(200);
  });

  it("returns 404 for unknown call centres", async () => {
    const { cookie } = await superadmin();
    const id = "00000000-0000-4000-8000-000000000000";
    expect((await call(cookie, "GET", `/admin/organizations/${id}`)).status).toBe(404);
    expect((await call(cookie, "PATCH", `/admin/organizations/${id}`, { note: "x" })).status).toBe(404);
  });
});

describe("superadmin API: invitations", () => {
  it("invites the call centre's admin and returns a single link", async () => {
    const { cookie, userId } = await superadmin();
    const { body } = await call(cookie, "POST", "/admin/organizations", { name: "Inviter AS" });
    const phone = `+479${String(randomBytes(4).readUInt32BE() % 10_000_000).padStart(7, "0")}`;
    const invited = await call(cookie, "POST", `/admin/organizations/${body.id}/invitations`, {
      fullName: "Anne Admin",
      phone,
    });
    expect(invited.status).toBe(201);
    const token = new URL(invited.body.link).searchParams.get("invitasjon")!;
    expect(invited.body.link.startsWith(`${ORIGIN}/logg-inn?invitasjon=`)).toBe(true);

    const stored = await owner.query(
      "select i.token_hash, i.created_by, r.key from invitations i join memberships m on m.user_id = i.user_id and m.organization_id = i.organization_id join roles r on r.id = m.role_id where i.id = $1",
      [invited.body.id],
    );
    expect(stored.rows[0]).toEqual({ token_hash: sha256(token), created_by: userId, key: "admin" });

    const detail = await call(cookie, "GET", `/admin/organizations/${body.id}`);
    expect(detail.body.members).toMatchObject([{ name: "Anne Admin", phone, roleKey: "admin", userStatus: "invited" }]);
    expect(detail.body.invitations).toHaveLength(1);

    // Inviting the same person again reuses the user and gives a new link.
    const again = await call(cookie, "POST", `/admin/organizations/${body.id}/invitations`, {
      fullName: "Anne Admin",
      phone,
      roleKey: "leader",
    });
    expect(again.body.userId).toBe(invited.body.userId);

    const revoked = await call(cookie, "DELETE", `/admin/organizations/${body.id}/invitations/${invited.body.id}`);
    expect(revoked.status).toBe(200);
    expect((await call(cookie, "DELETE", `/admin/organizations/${body.id}/invitations/${invited.body.id}`)).status).toBe(404);
  });

  it("adds a person from another call centre without a link, and stops their old link", async () => {
    const { cookie } = await superadmin();
    const first = (await call(cookie, "POST", "/admin/organizations", { name: "Første AS" })).body;
    const second = (await call(cookie, "POST", "/admin/organizations", { name: "Andre AS" })).body;
    const phone = `+479${String(randomBytes(4).readUInt32BE() % 10_000_000).padStart(7, "0")}`;
    const invited = await call(cookie, "POST", `/admin/organizations/${first.id}/invitations`, { fullName: "Kari", phone });
    expect(invited.body.link).toEqual(expect.any(String));

    // The same person in another call centre: added, but no link that could claim the account.
    const again = await call(cookie, "POST", `/admin/organizations/${second.id}/invitations`, { fullName: "Kari", phone });
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({ userId: invited.body.userId, link: null, emailed: false });
    const links = await owner.query("select count(*)::int as n from invitations where user_id = $1", [invited.body.userId]);
    expect(links.rows[0].n).toBe(1);

    // The first link can no longer attach a new login, since the person now belongs to two.
    const redeemable = await owner.query("select app.invitation_redeemable($1) as ok", [invited.body.id]);
    expect(redeemable.rows[0].ok).toBe(false);
  });

  it("requires a name and a phone number or e-mail, and a known role", async () => {
    const { cookie } = await superadmin();
    const { body } = await call(cookie, "POST", "/admin/organizations", { name: "Feil AS" });
    const path = `/admin/organizations/${body.id}/invitations`;
    expect((await call(cookie, "POST", path, { phone: "91234567" })).body.error).toBe("Navn må fylles ut.");
    expect((await call(cookie, "POST", path, { fullName: "A" })).body.error).toBe("Fyll ut mobilnummer eller e-post.");
    expect((await call(cookie, "POST", path, { fullName: "A", phone: "123" })).status).toBe(400);
    expect((await call(cookie, "POST", path, { fullName: "A", email: "a@b.no", roleKey: "boss" })).body.error).toBe(
      "Ukjent rolle.",
    );
  });
});

describe("superadmin API: overview", () => {
  it("shows the platform at a glance, with this month's money", async () => {
    const { cookie } = await superadmin();
    const org = await createOrg();
    await member(org, "seller");
    const res = await call(cookie, "GET", "/admin/overview");
    expect(res.status).toBe(200);
    expect(res.body.organizations.total).toBeGreaterThanOrEqual(1);
    expect(res.body.users.active).toBeGreaterThanOrEqual(2);
    expect(res.body.days).toHaveLength(30);
    expect(res.body.days[29].day).toBe(res.body.today);
    expect(res.body.money).toEqual({
      mrr: expect.any(Number),
      arr: expect.any(Number),
      revenue: expect.any(Number),
      costs: expect.any(Number),
      result: expect.any(Number),
      outstanding: expect.any(Number),
      overdue: expect.any(Number),
      missed: expect.any(Number),
      drafts: expect.any(Number),
      scheduled: expect.any(Number),
    });

    const admin = await sessionFor(await member(org, "admin"));
    expect((await call(admin, "GET", "/admin/overview")).status).toBe(403);
  });
});
