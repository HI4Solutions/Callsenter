import { randomBytes } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { api, auth, createOrg, createUser, makePlatformAdmin, member, owner } from "../../../packages/db/test/helpers.ts";
import { createHandler } from "../src/api.ts";
import { sha256 } from "../src/auth/crypto.ts";
import type { AuthDeps } from "../src/auth/types.ts";
import { createAuthenticator, otherKey } from "./fake-authenticator.ts";

const ORIGIN = "https://app.test";
const deps: AuthDeps = {
  config: { appOrigin: ORIGIN, callbackBase: "https://api.test", providers: {} },
  authDb: auth,
  appDb: api,
  fetch,
  now: () => new Date(),
};
const handler = createHandler({ checkDatabase: async () => true, auth: async () => deps });

async function sessionFor(userId: string, provider = "bankid") {
  const token = randomBytes(32).toString("base64url");
  await owner.query(
    `insert into sessions (id_hash, user_id, provider, expires_at) values ($1, $2, $3, now() + interval '1 hour')`,
    [sha256(token), userId, provider],
  );
  return `vq_session=${token}`;
}

async function call(cookie: string | null, method: string, rawPath: string, body?: unknown, origin = ORIGIN) {
  const response = await handler({
    rawPath,
    requestContext: { http: { method, sourceIp: "127.0.0.1", userAgent: "vitest" } },
    headers: { origin },
    cookies: cookie ? [cookie] : [],
    body: body === undefined ? undefined : JSON.stringify(body),
  } as unknown as APIGatewayProxyEventV2);
  return {
    status: response.statusCode,
    body: response.body ? JSON.parse(String(response.body)) : undefined,
    cookies: response.cookies ?? [],
  };
}

async function register(cookie: string, authenticator = createAuthenticator({ rpID: "app.test", origin: ORIGIN })) {
  const options = await call(cookie, "POST", "/auth/passkey/register/options");
  expect(options.status).toBe(200);
  expect(options.body.options.rp.id).toBe("app.test");
  expect(options.body.options.authenticatorSelection.userVerification).toBe("required");
  const verify = await call(cookie, "POST", "/auth/passkey/register/verify", {
    challengeId: options.body.challengeId,
    response: authenticator.register(options.body.options.challenge),
    name: "Mac",
  });
  return { authenticator, verify };
}

async function login(authenticator: ReturnType<typeof createAuthenticator>, override: { origin?: string; wrongKey?: boolean } = {}) {
  const options = await call(null, "POST", "/auth/passkey/login/options");
  expect(options.status).toBe(200);
  return call(null, "POST", "/auth/passkey/login/verify", {
    challengeId: options.body.challengeId,
    response: authenticator.authenticate(options.body.options.challenge, {
      origin: override.origin,
      key: override.wrongKey ? otherKey() : undefined,
    }),
    next: "/admin",
  });
}

describe("passkeys", () => {
  it("a superadmin adds a passkey with BankID and then signs in with it as a strong session", async () => {
    const userId = await createUser("Passkey Admin");
    await makePlatformAdmin(userId);
    const { authenticator, verify } = await register(await sessionFor(userId));
    expect(verify.status).toBe(201);

    const result = await login(authenticator);
    expect(result.status).toBe(200);
    expect(result.body.location).toBe("/admin");
    const cookie = result.cookies[0]!;
    expect(cookie).toMatch(/^vq_session=[\w-]{43}; Max-Age=50400; Path=\/; HttpOnly; Secure; SameSite=Lax$/);

    const token = cookie.split(";")[0]!;
    const me = await call(token, "GET", "/me");
    expect(me.body).toMatchObject({ provider: "passkey", strongAuthentication: true, platformAdmin: true });
    expect((await call(token, "GET", "/admin/organizations")).status).toBe(200);

    const events = await owner.query("select result from login_events where user_id = $1 and provider = 'passkey'", [userId]);
    expect(events.rows).toEqual([{ result: "success" }]);
    const list = await call(token, "GET", "/me/passkeys");
    expect(list.body).toMatchObject([{ name: "Mac" }]);
  });

  it("can only be added in a BankID session", async () => {
    const org = await createOrg();
    const userId = await member(org, "seller");
    const vipps = await sessionFor(userId, "vipps");
    const res = await call(vipps, "POST", "/auth/passkey/register/options");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Du må være logget inn med BankID for å legge til en passkey.");
    expect((await call(null, "POST", "/auth/passkey/register/options")).status).toBe(401);
  });

  it("rejects a wrong signature, a foreign origin, an unknown passkey and reused challenges", async () => {
    const userId = await createUser("Avvist");
    const cookie = await sessionFor(userId);
    const { authenticator } = await register(cookie);

    expect((await login(authenticator, { wrongKey: true })).status).toBe(400);
    expect((await login(authenticator, { origin: "https://evil.example" })).status).toBe(400);
    const stranger = createAuthenticator({ rpID: "app.test", origin: ORIGIN });
    const unknown = await login(stranger);
    expect(unknown.body.error).toBe("Denne passkeyen er ikke registrert. Logg inn med BankID eller Vipps.");

    const options = await call(null, "POST", "/auth/passkey/login/options");
    const response = authenticator.authenticate(options.body.options.challenge);
    const body = { challengeId: options.body.challengeId, response };
    expect((await call(null, "POST", "/auth/passkey/login/verify", body)).status).toBe(200);
    const again = await call(null, "POST", "/auth/passkey/login/verify", body);
    expect(again.body.error).toBe("Forespørselen er utløpt. Prøv igjen.");
  });

  it("refuses disabled users, calls from other origins, and lets users remove their passkeys", async () => {
    const userId = await createUser("Fjernes");
    const cookie = await sessionFor(userId);
    const { authenticator, verify } = await register(cookie);
    expect((await call(null, "POST", "/auth/passkey/login/options", undefined, "https://evil.example")).status).toBe(403);

    await owner.query("update users set status = 'disabled' where id = $1", [userId]);
    expect((await login(authenticator)).status).toBe(403);
    await owner.query("update users set status = 'active' where id = $1", [userId]);

    expect((await call(cookie, "DELETE", `/me/passkeys/${verify.body.id}`)).status).toBe(200);
    expect((await login(authenticator)).status).toBe(400);
  });
});

describe("passkeys in the superadmin portal", () => {
  it("are listed on the user and can be removed, signing the user out", async () => {
    const admin = await createUser("Super");
    await makePlatformAdmin(admin);
    const adminCookie = await sessionFor(admin);
    const userId = await createUser("Mistet telefon");
    const userCookie = await sessionFor(userId);
    const { verify } = await register(userCookie);

    const detail = await call(adminCookie, "GET", `/admin/users/${userId}`);
    expect(detail.body.passkeys).toMatchObject([{ id: verify.body.id, name: "Mac" }]);
    expect((await call(adminCookie, "DELETE", `/admin/users/${userId}/passkeys/${verify.body.id}`)).status).toBe(200);
    expect((await call(userCookie, "GET", "/me")).status).toBe(401);
  });
});
