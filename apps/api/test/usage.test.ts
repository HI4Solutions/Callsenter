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
  fetch: (async (input: string | URL | Request) =>
    String(input).includes("norges-bank")
      ? new Response(
          JSON.stringify({
            data: {
              dataSets: [{ series: { "0:0:0:0": { observations: { "0": ["10.5"] } } } }],
              structure: { dimensions: { observation: [{ values: [{ id: "2026-10-01" }] }] } },
            },
          }),
        )
      : fetch(input)) as typeof fetch,
  now: () => new Date(),
};
const handler = createHandler({ checkDatabase: async () => true, auth: async () => deps });

async function sessionFor(userId: string, provider: Provider = "bankid", orgId: string | null = null) {
  const token = randomBytes(32).toString("base64url");
  await owner.query(
    `insert into sessions (id_hash, user_id, provider, active_organization_id, created_at, last_seen_at, expires_at)
     values ($1, $2, $3, $4, now(), now(), now() + interval '1 hour')`,
    [sha256(token), userId, provider, orgId],
  );
  return `vq_session=${token}`;
}

async function superadmin(provider: Provider = "bankid") {
  const userId = await createUser("Super Admin");
  await makePlatformAdmin(userId);
  return { userId, cookie: await sessionFor(userId, provider) };
}

async function call(cookie: string, method: string, rawPath: string, body?: unknown, origin = ORIGIN) {
  const [pathOnly, search] = rawPath.split("?");
  const response = await handler({
    rawPath: pathOnly,
    queryStringParameters: search ? Object.fromEntries(new URLSearchParams(search)) : undefined,
    requestContext: { http: { method, sourceIp: "127.0.0.1", userAgent: "vitest" } },
    headers: { origin },
    cookies: [cookie],
    body: body === undefined ? undefined : JSON.stringify(body),
  } as unknown as APIGatewayProxyEventV2);
  return { status: response.statusCode, body: response.body ? JSON.parse(String(response.body)) : undefined };
}

describe("usage and costs", () => {
  it("prices AI, Soniox and eID per call centre, in USD and NOK", async () => {
    const admin = await superadmin();
    const org = await createOrg();
    const sellerId = await member(org, "seller");
    // A rate from Norges Bank (fake) and prices.
    const rate = await call(admin.cookie, "POST", "/admin/usage/rate");
    expect(rate.body).toEqual({ day: "2026-10-01", rate: 10.5 });
    const updated = await call(admin.cookie, "PATCH", "/admin/usage/prices", {
      services: { bankid_login: "2", soniox_async_hour: "0.10" },
      models: [{ model: "test-model", name: "Testmodell", input: "1", output: "2" }],
    });
    expect(updated.status).toBe(200);

    // One hour of audio (0.10 USD) and an AI control with 1M in and 1M out on Sonnet 4.6 (18 USD).
    await owner.query(
      `insert into usage_events (organization_id, kind, audio_seconds) values ($1, 'transcription_async', 3600);
       insert into usage_events (organization_id, kind, input_tokens, output_tokens, model) values ($1, 'ai_control', 1000000, 1000000, 'eu.anthropic.claude-sonnet-4-6')`.replaceAll("$1", `'${org}'`),
    );
    await owner.query("insert into login_events (provider, result, user_id) values ('bankid', 'success', $1), ('bankid', 'cancelled', $1)", [sellerId]);

    const detail = await call(admin.cookie, "GET", `/admin/usage/organizations/${org}`);
    expect(detail.status).toBe(200);
    expect(detail.body.ai).toMatchObject({ calls: 1, inputTokens: 1000000, outputTokens: 1000000, usd: 18 });
    expect(detail.body.soniox).toMatchObject({ transcriptions: 1, asyncHours: 1, usd: 0.1 });
    expect(detail.body.eid.find((e: { provider: string }) => e.provider === "bankid")).toMatchObject({
      logins: 1,
      registrations: 1,
      cancelled: 1,
      nok: 2,
    });
    expect(detail.body.usd).toBe(18.1);
    expect(detail.body.nok).toBe(Math.round((18.1 * 10.5 + 2) * 100) / 100);
    expect(detail.body.models[0]).toMatchObject({ name: "Claude Sonnet 4.6", usd: 18 });

    const rows = await call(admin.cookie, "GET", "/admin/usage/organizations");
    const row = rows.body.find((r: { id: string }) => r.id === org);
    expect(row).toMatchObject({ transcriptions: 1, total: Math.round((18.1 * 10.5 + 2) * 100) / 100 });
    expect(row.today).toBe(row.total);

    const summary = await call(admin.cookie, "GET", "/admin/usage/summary", undefined);
    expect(summary.status).toBe(200);
    const prices = await call(admin.cookie, "GET", "/admin/usage/prices");
    expect(prices.body.models.map((m: { model: string }) => m.model)).toContain("test-model");

    // Only superadmins.
    const orgAdmin = await sessionFor(await member(org, "admin"), "bankid", org);
    expect((await call(orgAdmin, "GET", "/admin/usage/summary")).status).toBe(403);
  });
});
