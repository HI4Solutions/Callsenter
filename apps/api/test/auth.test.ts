import { randomBytes } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { STRONG_AUTH_PERMISSIONS } from "@veriqall/shared";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, auth, createOrg, member, owner } from "../../../packages/db/test/helpers.ts";
import { createHandler } from "../src/api.ts";
import { sha256 } from "../src/auth/crypto.ts";
import { handleCallback, safeReturnPath, startLogin } from "../src/auth/flow.ts";
import { clearOidcCaches } from "../src/auth/oidc.ts";
import { resolveSession, revokeSession } from "../src/auth/session.ts";
import type { AuthDeps, Provider } from "../src/auth/types.ts";
import { loadMe } from "../src/me.ts";
import { createFakeIdp, type FakeUser } from "./fake-idp.ts";

let vipps: Awaited<ReturnType<typeof createFakeIdp>>;
let bankid: Awaited<ReturnType<typeof createFakeIdp>>;
let deps: AuthDeps;

beforeAll(async () => {
  vipps = await createFakeIdp({ issuer: "https://vipps.test", clientId: "vipps-client", clientSecret: "vs", userinfo: true });
  bankid = await createFakeIdp({ issuer: "https://idura.test", clientId: "idura-client", clientSecret: "is", userinfo: false });
  deps = {
    config: {
      appOrigin: "https://app.test",
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
});

beforeEach(() => {
  clearOidcCaches();
  vipps.tamper.nonce = undefined;
  bankid.tamper.nonce = undefined;
});

const meta = { ip: "127.0.0.1", userAgent: "vitest" };
const randomPhone = () => `+479${String(randomBytes(4).readUInt32BE() % 10_000_000).padStart(7, "0")}`;
const randomSub = () => randomBytes(8).toString("hex");

async function login(provider: Provider, user: FakeUser, options: { invite?: string; next?: string; linkUserId?: string } = {}) {
  const url = await startLogin(deps, provider, options);
  const query = (provider === "vipps" ? vipps : bankid).approve(url, user);
  return { result: await handleCallback(deps, provider, query, meta), query };
}

// An invited user in a new call centre, as an admin would create them.
async function invite(options: { phone?: string; role?: string; status?: string } = {}) {
  const orgId = await createOrg();
  const { rows } = await owner.query<{ id: string }>(
    "insert into users (full_name, phone, status) values ('Kari Selger', $1, $2) returning id",
    [options.phone ?? null, options.status ?? "invited"],
  );
  const userId = rows[0]!.id;
  await owner.query(
    "insert into memberships (organization_id, user_id, role_id) select $1, $2, id from roles where organization_id = $1 and key = $3",
    [orgId, userId, options.role ?? "seller"],
  );
  const token = randomBytes(32).toString("base64url");
  await owner.query("insert into invitations (organization_id, user_id, token_hash) values ($1, $2, $3)", [
    orgId,
    userId,
    sha256(token),
  ]);
  return { orgId, userId, token };
}

const errorOf = (location: string) => new URL(location).searchParams.get("feil");

async function lastLoginEvent(userId?: string) {
  const { rows } = await owner.query(
    `select provider, result, user_id from login_events ${userId ? "where user_id = $1" : ""} order by id desc limit 1`,
    userId ? [userId] : [],
  );
  return rows[0];
}

describe("Vipps login", () => {
  it("links an invited user by verified phone number and opens a session", async () => {
    const phone = randomPhone();
    const { orgId, userId } = await invite({ phone });
    const sub = randomSub();
    const { result } = await login("vipps", { sub, name: "Kari Selger", phone: phone.slice(3) }, { next: "/samtaler" });

    expect(result.location).toBe("https://app.test/samtaler");
    expect(result.sessionToken).toBeTruthy();
    const session = await resolveSession(deps, result.sessionToken);
    expect(session).toMatchObject({ userId, provider: "vipps", strong: false, activeOrganizationId: orgId });

    const state = await owner.query(
      `select u.status, (select count(*)::int from identities where user_id = u.id and provider = 'vipps' and subject = $2) as identities,
              (select used_at is not null from invitations where user_id = u.id) as invitation_used
       from users u where u.id = $1`,
      [userId, sub],
    );
    expect(state.rows[0]).toEqual({ status: "active", identities: 1, invitation_used: true });
    expect(await lastLoginEvent(userId)).toMatchObject({ provider: "vipps", result: "success" });
  });

  it("finds the user by sub the next time, without any invitation", async () => {
    const phone = randomPhone();
    const { userId } = await invite({ phone });
    const sub = randomSub();
    await login("vipps", { sub, phone });
    const { result } = await login("vipps", { sub, phone: randomPhone() });
    expect((await resolveSession(deps, result.sessionToken))?.userId).toBe(userId);
  });

  it("does not accept a matching phone number without a valid invitation", async () => {
    const phone = randomPhone();
    const { userId } = await invite({ phone });
    await owner.query("update invitations set expires_at = now() - interval '1 minute' where user_id = $1", [userId]);
    const { result } = await login("vipps", { sub: randomSub(), phone });
    expect(errorOf(result.location)).toBe("ukjent");
    expect(result.sessionToken).toBeUndefined();
    expect(await lastLoginEvent()).toMatchObject({ result: "unknown_identity", user_id: null });
  });

  it("handles a login the user cancelled in the app", async () => {
    const result = await handleCallback(deps, "vipps", { error: "access_denied", state: "x" }, meta);
    expect(errorOf(result.location)).toBe("avbrutt");
    expect(await lastLoginEvent()).toMatchObject({ provider: "vipps", result: "cancelled" });
  });
});

describe("BankID login", () => {
  it("links the user from an invitation link and records the BankID level", async () => {
    const { userId, token } = await invite({ role: "admin" });
    const { result } = await login("bankid", { sub: randomSub(), name: "Ola Admin" }, { invite: token });
    const session = await resolveSession(deps, result.sessionToken);
    expect(session).toMatchObject({ userId, provider: "bankid", strong: true, acr: "urn:grn:authn:no:bankid" });
  });

  it("refuses an id token with the wrong nonce", async () => {
    const { token } = await invite();
    bankid.tamper.nonce = "someone-elses-nonce";
    const { result } = await login("bankid", { sub: randomSub() }, { invite: token });
    expect(errorOf(result.location)).toBe("feil");
    expect(result.sessionToken).toBeUndefined();
  });

  it("rejects an unknown or used invitation link before going to the provider", async () => {
    const location = await startLogin(deps, "bankid", { invite: "not-a-real-token" });
    expect(errorOf(location)).toBe("invitasjon");

    const { token } = await invite();
    await login("bankid", { sub: randomSub() }, { invite: token });
    expect(errorOf(await startLogin(deps, "bankid", { invite: token }))).toBe("invitasjon");
  });
});

describe("state and redirects", () => {
  it("accepts a state only once", async () => {
    const phone = randomPhone();
    await invite({ phone });
    const { query } = await login("vipps", { sub: randomSub(), phone });
    const again = await handleCallback(deps, "vipps", query, meta);
    expect(errorOf(again.location)).toBe("utlopt");
  });

  it("rejects a state older than ten minutes", async () => {
    const url = await startLogin(deps, "vipps", {});
    const query = vipps.approve(url, { sub: randomSub() });
    await owner.query("update auth_states set created_at = now() - interval '11 minutes' where state_hash = $1", [
      sha256(query.state),
    ]);
    expect(errorOf((await handleCallback(deps, "vipps", query, meta)).location)).toBe("utlopt");
  });

  it("only returns to relative paths inside the app", async () => {
    expect(safeReturnPath("/samtaler?side=2")).toBe("/samtaler?side=2");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", "/\t/evil.example", "/%09/x", "/.//evil.example", "/a/..//evil.example", "samtaler", undefined]) {
      expect(safeReturnPath(bad)).toBe("/");
    }
    const phone = randomPhone();
    await invite({ phone });
    const { result } = await login("vipps", { sub: randomSub(), phone }, { next: "//evil.example/x" });
    expect(result.location).toBe("https://app.test/");
  });

  it("refuses disabled users", async () => {
    const phone = randomPhone();
    const { userId } = await invite({ phone });
    const sub = randomSub();
    await login("vipps", { sub, phone });
    await owner.query("update users set status = 'disabled' where id = $1", [userId]);
    const { result } = await login("vipps", { sub, phone });
    expect(errorOf(result.location)).toBe("deaktivert");
  });
});

describe("adding a second login method", () => {
  it("links BankID to a user who signed in with Vipps", async () => {
    const phone = randomPhone();
    const { userId } = await invite({ phone });
    await login("vipps", { sub: randomSub(), phone });
    const bankidSub = randomSub();
    const { result } = await login("bankid", { sub: bankidSub }, { linkUserId: userId });
    expect((await resolveSession(deps, result.sessionToken))?.userId).toBe(userId);
  });

  it("refuses to link an identity that belongs to someone else", async () => {
    const phone = randomPhone();
    const first = await invite({ phone });
    const sub = randomSub();
    await login("vipps", { sub, phone });
    const second = await invite();
    const { result } = await login("vipps", { sub }, { linkUserId: second.userId });
    expect(errorOf(result.location)).toBe("allerede_koblet");
    void first;
  });
});

describe("sessions", () => {
  async function sessionFor(provider: Provider = "vipps") {
    const phone = randomPhone();
    const invited = await invite({ phone, role: "admin" });
    const { result } =
      provider === "vipps"
        ? await login("vipps", { sub: randomSub(), phone })
        : await login("bankid", { sub: randomSub() }, { invite: invited.token });
    return { ...invited, token: result.sessionToken! };
  }

  it("expire after 60 minutes without activity", async () => {
    const { token } = await sessionFor();
    await owner.query("update sessions set last_seen_at = now() - interval '61 minutes' where id_hash = $1", [sha256(token)]);
    expect(await resolveSession(deps, token)).toBeNull();
  });

  it("expire after 14 hours in total", async () => {
    const { token } = await sessionFor();
    const in14h = new Date(Date.now() + 14 * 3_600_000 + 1000);
    await owner.query("update sessions set last_seen_at = $2 where id_hash = $1", [sha256(token), new Date(in14h.getTime() - 60_000)]);
    expect(await resolveSession({ ...deps, now: () => in14h }, token)).toBeNull();
  });

  it("end on logout", async () => {
    const { token } = await sessionFor();
    await revokeSession(deps, token);
    expect(await resolveSession(deps, token)).toBeNull();
  });

  it("give administrative permissions only to BankID sessions", async () => {
    const vippsSession = await sessionFor("vipps");
    const meVipps = await loadMe(api, (await resolveSession(deps, vippsSession.token))!);
    for (const permission of STRONG_AUTH_PERMISSIONS) expect(meVipps.permissions).not.toContain(permission);
    expect(meVipps.permissions).toContain("sales.manage");
    expect(meVipps.strongAuthentication).toBe(false);

    const bankidSession = await sessionFor("bankid");
    const meBankid = await loadMe(api, (await resolveSession(deps, bankidSession.token))!);
    expect(meBankid.permissions).toEqual(expect.arrayContaining([...STRONG_AUTH_PERMISSIONS]));
    expect(meBankid.organizations.map((o) => o.id)).toEqual([bankidSession.orgId]);
  });
});

describe("HTTP", () => {
  const handler = () => createHandler({ checkDatabase: async () => true, auth: async () => deps });
  function event(method: string, rawPath: string, extra: Partial<APIGatewayProxyEventV2> = {}) {
    return {
      rawPath,
      requestContext: { http: { method, sourceIp: "127.0.0.1", userAgent: "vitest" } },
      headers: {},
      ...extra,
    } as unknown as APIGatewayProxyEventV2;
  }

  it("starts at the provider, and sets a secure session cookie on the way back", async () => {
    const start = await handler()(event("GET", "/auth/vipps/start", { queryStringParameters: { next: "/" } }));
    expect(start.statusCode).toBe(302);
    const location = String(start.headers?.location);
    expect(location.startsWith("https://vipps.test/authorize?")).toBe(true);

    const phone = randomPhone();
    await invite({ phone });
    const query = vipps.approve(location, { sub: randomSub(), phone });
    const back = await handler()(event("GET", "/auth/vipps/callback", { queryStringParameters: query }));
    expect(back.statusCode).toBe(302);
    expect(back.headers?.location).toBe("https://app.test/");
    const cookie = back.cookies?.[0] ?? "";
    expect(cookie).toMatch(/^vq_session=[\w-]{43};/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Domain=");

    const token = cookie.split(";")[0]!;
    const me = await handler()(event("GET", "/me", { cookies: [token], headers: { origin: "https://app.test" } }));
    expect(me.statusCode).toBe(200);
    expect(me.headers?.["access-control-allow-origin"]).toBe("https://app.test");
    expect(JSON.parse(String(me.body)).user.name).toBe("Kari Selger");

    const foreign = await handler()(event("POST", "/auth/logout", { cookies: [token], headers: { origin: "https://evil.example" } }));
    expect(foreign.statusCode).toBe(403);
    const logout = await handler()(event("POST", "/auth/logout", { cookies: [token], headers: { origin: "https://app.test" } }));
    expect(logout.statusCode).toBe(204);
    const after = await handler()(event("GET", "/me", { cookies: [token] }));
    expect(after.statusCode).toBe(401);
  });

  it("says when a provider is not set up yet", async () => {
    const noBankid = createHandler({
      checkDatabase: async () => true,
      auth: async () => ({ ...deps, config: { ...deps.config, providers: { vipps: deps.config.providers.vipps } } }),
    });
    const res = await noBankid(event("GET", "/auth/bankid/start"));
    expect(errorOf(String(res.headers?.location))).toBe("ikke_satt_opp");
  });
});
