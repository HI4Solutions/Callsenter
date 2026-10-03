import { randomBytes } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { addMember, api, auth, createOrg, createUser, makePlatformAdmin, member, owner, roleId } from "../../../packages/db/test/helpers.ts";
import { createHandler } from "../src/api.ts";
import { sha256 } from "../src/auth/crypto.ts";
import type { AuthDeps } from "../src/auth/types.ts";
import { roleKeyFrom } from "../src/org/roles.ts";

const ORIGIN = "https://app.test";
const deps: AuthDeps = {
  config: { appOrigin: ORIGIN, callbackBase: "https://api.test", providers: {} },
  authDb: auth,
  appDb: api,
  fetch,
  now: () => new Date(),
};
const handler = createHandler({ checkDatabase: async () => true, auth: async () => deps });

async function sessionFor(userId: string, orgId: string | null) {
  const token = randomBytes(32).toString("base64url");
  await owner.query(
    `insert into sessions (id_hash, user_id, provider, active_organization_id, expires_at)
     values ($1, $2, 'bankid', $3, now() + interval '1 hour')`,
    [sha256(token), userId, orgId],
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

describe("roles", () => {
  it("makes role keys from Norwegian names", () => {
    expect(roleKeyFrom("Teamleder Sør")).toBe("teamleder_sor");
    expect(roleKeyFrom("Kvalitet & Klage")).toBe("kvalitet_klage");
    expect(roleKeyFrom("2. linje")).toBe("rolle_2_linje");
  });

  it("creates a role with permissions, renames it, changes permissions and archives it", async () => {
    const org = await createOrg();
    const admin = await member(org, "admin");
    const cookie = await sessionFor(admin, org);
    const created = await call(cookie, "POST", "/org/roles", { name: "Kvalitet", permissions: ["calls.read.all", "flags.review"] });
    expect(created.status).toBe(201);
    expect(created.body.key).toBe("kvalitet");
    const second = await call(cookie, "POST", "/org/roles", { name: "Kvalitet", permissions: [] });
    expect(second.body.key).toBe("kvalitet_2");

    const id = created.body.id;
    await call(cookie, "PATCH", `/org/roles/${id}`, { name: "Kvalitetssikring", permissions: ["flags.review", "dashboard.all"] });
    const list = await call(cookie, "GET", "/org/roles");
    const role = list.body.roles.find((r: { id: string }) => r.id === id);
    expect(role).toMatchObject({ name: "Kvalitetssikring", permissions: ["dashboard.all", "flags.review"], members: 0 });
    expect(list.body.permissions.find((p: { key: string }) => p.key === "audit.read")).toMatchObject({
      held: true,
      requiresBankId: true,
    });

    expect((await call(cookie, "PATCH", `/org/roles/${id}`, { archived: true })).status).toBe(200);
    expect((await call(cookie, "POST", "/org/roles", { name: "X", permissions: ["superadmin"] })).status).toBe(400);
  });

  it("protects your own role, roles in use, and permissions you lack", async () => {
    const org = await createOrg();
    const admin = await member(org, "admin");
    const cookie = await sessionFor(admin, org);
    const adminRole = await roleId(org, "admin");
    const own = await call(cookie, "PATCH", `/org/roles/${adminRole}`, { permissions: [] });
    expect(own.body.error).toBe("Du kan ikke endre rettighetene til rollen du har selv.");
    await member(org, "seller");
    const inUse = await call(cookie, "PATCH", `/org/roles/${await roleId(org, "seller")}`, { archived: true });
    expect(inUse.body.error).toBe("Rollen har brukere. Gi dem en annen rolle før du arkiverer den.");

    // A leader allowed to manage roles, but without audit.read.
    const leaderRole = await roleId(org, "leader");
    await owner.query(
      "insert into role_permissions (role_id, organization_id, permission) values ($1, $2, 'roles.manage'), ($1, $2, 'users.manage')",
      [leaderRole, org],
    );
    const lead = await createUser();
    await addMember(org, lead, "leader");
    const leadCookie = await sessionFor(lead, org);
    const res = await call(leadCookie, "POST", "/org/roles", { name: "Revisor", permissions: ["audit.read"] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Du kan ikke gi en rolle rettigheter du ikke har selv.");
    // Nor take rights away from a stronger role, or disable, demote or re-invite its members.
    const weaken = await call(leadCookie, "PATCH", `/org/roles/${adminRole}`, { permissions: ["calls.read.own"] });
    expect(weaken.body.error).toBe("Rollen har rettigheter du ikke har selv, og kan ikke endres av deg.");
    const demote = await call(leadCookie, "PATCH", `/org/members/${admin}`, { status: "disabled" });
    expect(demote.body.error).toBe("Du kan ikke endre en bruker som har rettigheter du ikke har selv.");
    const adminPhone = `+479${String(randomBytes(4).readUInt32BE() % 10_000_000).padStart(7, "0")}`;
    await owner.query("update users set phone = $2 where id = $1", [admin, adminPhone]);
    const reinvite = await call(leadCookie, "POST", "/org/invitations", { fullName: "Admin", phone: adminPhone, roleId: await roleId(org, "seller") });
    expect(reinvite.body.error).toBe("Brukeren har rettigheter du ikke har selv.");
    const state = await owner.query("select m.status, r.key from memberships m join roles r on r.id = m.role_id where m.user_id = $1", [admin]);
    expect(state.rows).toEqual([{ status: "active", key: "admin" }]);
    // A seller is within the leader's rights.
    const seller = await member(org, "seller");
    expect((await call(leadCookie, "PATCH", `/org/members/${seller}`, { status: "disabled" })).status).toBe(200);
    // Sellers cannot manage roles at all.
    expect((await call(await sessionFor(seller, org), "GET", "/org/roles")).status).toBe(403);
  });
});

describe("support threads", () => {
  it("lets an admin and a superadmin talk, with unread markers on both sides", async () => {
    const org = await createOrg("Tråd AS");
    const admin = await member(org, "admin");
    const adminCookie = await sessionFor(admin, org);
    const superId = await createUser("Nadeem");
    await makePlatformAdmin(superId);
    const superCookie = await sessionFor(superId, null);

    const started = await call(adminCookie, "POST", "/org/threads", { subject: "Spørsmål om faktura", body: "Hei, når kommer den?" });
    expect(started.status).toBe(201);
    const id = started.body.id;

    const inbox = await call(superCookie, "GET", "/admin/threads");
    expect(inbox.body.find((t: { id: string }) => t.id === id)).toMatchObject({ organizationName: "Tråd AS", unread: true });
    const opened = await call(superCookie, "GET", `/admin/threads/${id}`);
    expect(opened.body.messages).toMatchObject([{ body: "Hei, når kommer den?", fromPlatform: false }]);
    expect((await call(superCookie, "GET", "/admin/threads")).body.find((t: { id: string }) => t.id === id).unread).toBe(false);

    await call(superCookie, "POST", `/admin/threads/${id}/messages`, { body: "Den kommer fredag." });
    const orgList = await call(adminCookie, "GET", "/org/threads");
    expect(orgList.body).toMatchObject([{ id, unread: true, messages: 2 }]);
    const thread = await call(adminCookie, "GET", `/org/threads/${id}`);
    expect(thread.body.messages[1]).toMatchObject({ author: "VeriQall", fromPlatform: true, mine: false });

    expect((await call(adminCookie, "PATCH", `/org/threads/${id}`, { status: "closed" })).status).toBe(200);
    expect((await call(adminCookie, "POST", `/org/threads/${id}/messages`, { body: " " })).status).toBe(400);
  });

  it("lets a superadmin start a conversation with a call centre, hidden from other call centres and sellers", async () => {
    const org = await createOrg();
    const other = await createOrg();
    const superId = await createUser();
    await makePlatformAdmin(superId);
    const superCookie = await sessionFor(superId, null);
    const started = await call(superCookie, "POST", "/admin/threads", { organizationId: org, subject: "Velkommen", body: "Hei!" });
    expect(started.status).toBe(201);
    const otherAdmin = await member(other, "admin");
    expect((await call(await sessionFor(otherAdmin, other), "GET", "/org/threads")).body).toEqual([]);
    const seller = await member(org, "seller");
    expect((await call(await sessionFor(seller, org), "GET", "/org/threads")).status).toBe(403);
    expect((await call(superCookie, "POST", "/admin/threads", { subject: "x", body: "y" })).body.error).toBe("Velg et callsenter.");
  });
});
