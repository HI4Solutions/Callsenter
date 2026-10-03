import { randomBytes } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { addMember, api, auth, createOrg, createUser, makePlatformAdmin, member, owner, roleId } from "../../../packages/db/test/helpers.ts";
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

async function sessionFor(userId: string, orgId: string | null, provider = "bankid") {
  const token = randomBytes(32).toString("base64url");
  await owner.query(
    `insert into sessions (id_hash, user_id, provider, active_organization_id, expires_at)
     values ($1, $2, $3, $4, now() + interval '1 hour')`,
    [sha256(token), userId, provider, orgId],
  );
  return `vq_session=${token}`;
}

async function call(cookie: string, method: string, rawPath: string, body?: unknown) {
  const response = await handler({
    rawPath,
    requestContext: { http: { method, sourceIp: "127.0.0.1", userAgent: "vitest" } },
    headers: { origin: ORIGIN },
    cookies: [cookie],
    body: body === undefined ? undefined : JSON.stringify(body),
  } as unknown as APIGatewayProxyEventV2);
  return { status: response.statusCode, body: response.body ? JSON.parse(String(response.body)) : undefined };
}

const phone = () => `+479${String(randomBytes(4).readUInt32BE() % 10_000_000).padStart(7, "0")}`;

async function adminOf(org: string, provider = "bankid") {
  const userId = await member(org, "admin");
  return { userId, cookie: await sessionFor(userId, org, provider) };
}

describe("call centre admin: access", () => {
  it("needs users.manage, which needs BankID or a passkey", async () => {
    const org = await createOrg();
    const seller = await member(org, "seller");
    expect((await call(await sessionFor(seller, org), "GET", "/org/overview")).body.code).toBe("ingen_tilgang");
    const vipps = await adminOf(org, "vipps");
    expect((await call(vipps.cookie, "GET", "/org/overview")).body.code).toBe("krever_bankid");
    const passkey = await adminOf(org, "passkey");
    expect((await call(passkey.cookie, "GET", "/org/overview")).status).toBe(200);
  });

  it("gives the admin an overview of users, teams, usage and invoices", async () => {
    const org = await createOrg();
    const admin = await adminOf(org);
    const res = await call(admin.cookie, "GET", "/org/summary");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ members: { active: 1, invited: 0 }, usage: { month: { hours: 0, controls: 0, notes: 0 } }, modules: [] });
    const seller = await member(org, "seller");
    expect((await call(await sessionFor(seller, org), "GET", "/org/summary")).status).toBe(403);
  });

  it("sees only its own call centre", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    await member(orgB, "seller");
    const { cookie } = await adminOf(orgA);
    const res = await call(cookie, "GET", "/org/overview");
    expect(res.body.members).toHaveLength(1);
    expect(res.body.roles.map((r: { key: string }) => r.key).sort()).toEqual(["admin", "compliance", "leader", "seller"]);
  });
});

describe("call centre admin: members", () => {
  it("invites a seller into a team, also someone who is a user elsewhere", async () => {
    const org = await createOrg();
    const { cookie } = await adminOf(org);
    const team = await call(cookie, "POST", "/org/teams", { name: "Team Nord" });
    expect(team.status).toBe(201);
    const seller = await roleId(org, "seller");

    const invited = await call(cookie, "POST", "/org/invitations", {
      fullName: "Ny Selger",
      phone: phone(),
      roleId: seller,
      teamId: team.body.id,
    });
    expect(invited.status).toBe(201);
    expect(invited.body.link).toMatch(/^https:\/\/app\.test\/logg-inn\?invitasjon=/);

    const elsewhereOrg = await createOrg();
    const elsewhere = await member(elsewhereOrg, "leader");
    const number = phone();
    await owner.query("update users set phone = $2 where id = $1", [elsewhere, number]);
    const again = await call(cookie, "POST", "/org/invitations", { fullName: "Finnes Fra Før", phone: number, roleId: seller });
    expect(again.status).toBe(201);
    expect(again.body.userId).toBe(elsewhere);

    const overview = await call(cookie, "GET", "/org/overview");
    const names = overview.body.members.map((m: { name: string }) => m.name);
    expect(names).toContain("Ny Selger");
    expect(overview.body.members.find((m: { name: string }) => m.name === "Ny Selger").teamName).toBe("Team Nord");
    // The existing user keeps their own name.
    expect(names).not.toContain("Finnes Fra Før");
    expect(overview.body.teams).toMatchObject([{ name: "Team Nord", members: 1 }]);
  });

  it("changes role, team and status, but never your own", async () => {
    const org = await createOrg();
    const { cookie, userId: me } = await adminOf(org);
    const seller = await member(org, "seller");
    const leader = await roleId(org, "leader");
    expect((await call(cookie, "PATCH", `/org/members/${seller}`, { roleId: leader })).status).toBe(200);
    expect((await call(cookie, "PATCH", `/org/members/${seller}`, { status: "disabled" })).status).toBe(200);
    const row = await owner.query(
      "select r.key, m.status from memberships m join roles r on r.id = m.role_id where m.user_id = $1 and m.organization_id = $2",
      [seller, org],
    );
    expect(row.rows[0]).toEqual({ key: "leader", status: "disabled" });
    const own = await call(cookie, "PATCH", `/org/members/${me}`, { status: "disabled" });
    expect(own.body.error).toBe("Du kan ikke endre ditt eget medlemskap.");
    // A logged-in user's name comes from BankID or Vipps.
    expect((await call(cookie, "PATCH", `/org/members/${seller}`, { fullName: "Annet" })).status).toBe(400);
  });

  it("cannot hand out a role with permissions the admin lacks", async () => {
    const org = await createOrg();
    // A leader with users.manage added, but without audit.read.
    const leaderRole = await roleId(org, "leader");
    await owner.query("insert into role_permissions (role_id, organization_id, permission) values ($1, $2, 'users.manage')", [
      leaderRole,
      org,
    ]);
    const lead = await createUser("Leder Med Brukere");
    await addMember(org, lead, "leader");
    const cookie = await sessionFor(lead, org);
    const overview = await call(cookie, "GET", "/org/overview");
    const admin = overview.body.roles.find((r: { key: string }) => r.key === "admin");
    expect(admin.assignable).toBe(false);
    const res = await call(cookie, "POST", "/org/invitations", { fullName: "X", phone: phone(), roleId: admin.id });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Du kan ikke gi en rolle med rettigheter du ikke har selv.");
  });
});

describe("call centre admin: teams", () => {
  it("creates, renames and archives teams; archiving clears the team on members", async () => {
    const org = await createOrg();
    const { cookie } = await adminOf(org);
    const team = (await call(cookie, "POST", "/org/teams", { name: "Sør" })).body.id;
    const seller = await member(org, "seller");
    await call(cookie, "PATCH", `/org/members/${seller}`, { teamId: team });
    expect((await call(cookie, "PATCH", `/org/teams/${team}`, { name: "Sør-Vest" })).status).toBe(200);
    expect((await call(cookie, "PATCH", `/org/teams/${team}`, { archived: true })).status).toBe(200);
    const m = await owner.query("select team_id from memberships where user_id = $1", [seller]);
    expect(m.rows[0].team_id).toBeNull();
    expect((await call(cookie, "POST", "/org/teams", { name: " " })).status).toBe(400);
  });
});

describe("switching call centre", () => {
  it("lets members switch between their call centres, and superadmins step into any", async () => {
    const orgA = await createOrg("Første AS");
    const orgB = await createOrg("Andre AS");
    const userId = await member(orgA, "admin");
    await addMember(orgB, userId, "seller");
    const cookie = await sessionFor(userId, orgA);
    expect((await call(cookie, "POST", "/me/organization", { organizationId: orgB })).status).toBe(200);
    expect((await call(cookie, "GET", "/me")).body.activeOrganizationId).toBe(orgB);

    const stranger = await createOrg();
    expect((await call(cookie, "POST", "/me/organization", { organizationId: stranger })).status).toBe(403);

    const superId = await createUser("Super");
    await makePlatformAdmin(superId);
    const superCookie = await sessionFor(superId, null);
    expect((await call(superCookie, "POST", "/me/organization", { organizationId: orgA })).status).toBe(200);
    const me = await call(superCookie, "GET", "/me");
    expect(me.body.organizations).toEqual([{ id: orgA, name: "Første AS" }]);
    expect((await call(superCookie, "GET", "/org/overview")).status).toBe(200);
  });
});
