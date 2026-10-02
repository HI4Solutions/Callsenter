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


async function setup() {
  const org = await createOrg();
  await owner.query("insert into organization_modules (organization_id, module) values ($1, 'dashboard')", [org]);
  const team = (await owner.query("insert into teams (organization_id, name) values ($1, 'Nord') returning id", [org])).rows[0].id;
  const sellerId = await member(org, "seller");
  const leaderId = await member(org, "leader");
  await owner.query("update memberships set team_id = $2 where organization_id = $1 and user_id = any($3)", [org, team, [sellerId, leaderId]]);
  return { org, team, sellerId, seller: await sessionFor(sellerId, org), leader: await sessionFor(leaderId, org) };
}

describe("dashboard", () => {
  it("shows own numbers to everyone, and the team's to the leader", async () => {
    const s = await setup();
    const mine = await call(s.seller, "GET", "/org/dashboard");
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ scope: "me", teams: [], canSeeAll: false, sales: { total: 0 } });
    expect(mine.body.daily).toHaveLength(30);

    expect((await call(s.seller, "GET", "/org/dashboard", undefined, { scope: "team", target: s.team })).status).toBe(403);
    const team = await call(s.leader, "GET", "/org/dashboard", undefined, { scope: "team", target: s.team, from: "2026-09-01", to: "2026-09-07" });
    expect(team.status).toBe(200);
    expect(team.body).toMatchObject({ targetName: "Nord", teams: [{ id: s.team, name: "Nord" }], from: "2026-09-01", to: "2026-09-07" });
    expect(team.body.daily.map((d: { day: string }) => d.day)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"]);
    expect(team.body.sellers).toHaveLength(2);

    expect((await call(s.leader, "GET", "/org/dashboard", undefined, { from: "2026-09-07", to: "2026-09-01" })).status).toBe(400);
    expect((await call(s.leader, "GET", "/org/dashboard", undefined, { from: "2024-01-01", to: "2026-09-01" })).status).toBe(400);
    await owner.query("update organization_modules set enabled = false where organization_id = $1", [s.org]);
    expect((await call(s.seller, "GET", "/org/dashboard")).body.code).toBe("modul_av");
  });
});

describe("coaching", () => {
  it("lets a leader give feedback that the seller reads and marks as read", async () => {
    const s = await setup();
    const given = await call(s.leader, "POST", "/org/coaching", { sellerId: s.sellerId, kind: "praise", body: "God avslutning" });
    expect(given.status).toBe(201);
    expect((await call(s.seller, "POST", "/org/coaching", { sellerId: s.sellerId, kind: "praise", body: "Meg" })).status).toBe(403);

    const notes = await call(s.seller, "GET", "/org/coaching");
    expect(notes.body).toMatchObject({ canCoach: false, notes: [{ id: given.body.id, kind: "praise", body: "God avslutning", readAt: null }] });
    const leaderView = await call(s.leader, "GET", "/org/coaching", undefined, { sellerId: s.sellerId });
    expect(leaderView.body).toMatchObject({ canCoach: true, notes: [{ id: given.body.id }] });

    expect((await call(s.leader, "POST", `/org/coaching/${given.body.id}/read`)).status).toBe(404);
    expect((await call(s.seller, "POST", `/org/coaching/${given.body.id}/read`)).status).toBe(200);
    expect((await call(s.seller, "POST", `/org/coaching/${given.body.id}/read`)).status).toBe(200);
    expect((await call(s.seller, "GET", "/org/coaching")).body.notes[0].readAt).not.toBeNull();
  });
});
