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
  // Calls are only listed here; nothing is recorded or played.
  calls: {
    store: {
      presignPut: async () => "",
      presignGet: async () => "",
      list: async () => [],
      get: async () => new Uint8Array(),
      put: async () => undefined,
      delete: async () => undefined,
    },
    soniox: null,
    startWorker: async () => undefined,
    startPiece: async () => undefined,
  },
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

describe("dashboard: AI flags and calls to follow up", () => {
  it("counts flags per day and hour, lists the flagged calls of the period, and shows a call's log to leaders", async () => {
    const s = await setup();
    const adminId = await member(s.org, "admin");
    const admin = await sessionFor(adminId, s.org, "bankid");
    // Three calls by the seller on 1 September (Norwegian time): green, red and one not checked.
    const at = ["2026-09-01T08:15:00+02:00", "2026-09-01T09:30:00+02:00", "2026-09-01T09:45:00+02:00"];
    const ids: string[] = [];
    // The database sets the start time itself; the test moves it back with the guard off.
    const client = await owner.connect();
    try {
      await client.query("begin");
      await client.query("alter table calls disable trigger calls_guard");
      for (const t of at) {
        const id = (
          await client.query(
            `insert into calls (organization_id, user_id, source, transcription_mode, title)
             values ($1, $2, 'microphone', 'chunked', 'Test') returning id`,
            [s.org, s.sellerId],
          )
        ).rows[0].id;
        await client.query("update calls set started_at = $2 where id = $1", [id, t]);
        ids.push(id);
      }
      await client.query("alter table calls enable trigger calls_guard");
      await client.query("commit");
    } finally {
      client.release();
    }
    const product = (await owner.query("insert into products (organization_id, name) values ($1, 'Strøm') returning id", [s.org])).rows[0].id;
    const version = (
      await owner.query(
        `insert into product_template_versions (organization_id, product_id, version, status, published_at, price_monthly)
         values ($1, $2, 1, 'published', now(), 399) returning id`,
        [s.org, product],
      )
    ).rows[0].id;
    for (const [i, flag] of [[0, "green"], [1, "red"]] as const) {
      await owner.query(
        `insert into call_analyses (organization_id, call_id, template_version_id, model, flag, summary, findings)
         values ($1, $2, $3, 'm', $4, 'x', '[]')`,
        [s.org, ids[i], version, flag],
      );
    }
    const day = await call(admin, "GET", "/org/dashboard", undefined, { scope: "all", from: "2026-09-01", to: "2026-09-01" });
    expect(day.status).toBe(200);
    expect(day.body.daily).toEqual([{ day: "2026-09-01", sales: 0, confirmed: 0, calls: 3, green: 1, yellow: 0, red: 1 }]);
    expect(day.body.hourly).toHaveLength(24);
    expect(day.body.hourly[9]).toEqual({ hour: 9, calls: 2, green: 0, yellow: 0, red: 1 });
    const week = await call(admin, "GET", "/org/dashboard", undefined, { scope: "all", from: "2026-09-01", to: "2026-09-07" });
    expect(week.body.hourly).toEqual([]);

    const period = { from: "2026-09-01", to: "2026-09-01" };
    const flagged = await call(admin, "GET", "/org/calls", undefined, { ...period, flagged: "1" });
    expect(flagged.body.map((c: { id: string; flag: string; userName: string }) => [c.id, c.flag])).toEqual([[ids[1], "red"]]);
    expect(flagged.body[0].userName).toBeTruthy();
    expect((await call(admin, "GET", "/org/calls", undefined, { ...period, unchecked: "1" })).body.map((c: { id: string }) => c.id)).toEqual([ids[2]]);
    expect((await call(admin, "GET", "/org/calls", undefined, { ...period, teamId: s.team })).body).toHaveLength(3);
    expect((await call(admin, "GET", "/org/calls", undefined, { from: "2026-09-02", to: "2026-09-02" })).body).toHaveLength(0);

    // Viewing the call is logged, and leaders with audit.read see the log; the seller does not.
    await call(admin, "GET", `/org/calls/${ids[1]}`);
    const log = await call(admin, "GET", `/org/calls/${ids[1]}/log`);
    expect(log.status).toBe(200);
    expect(log.body.access[0]).toMatchObject({ action: "view", resource: "call" });
    expect(log.body.changes.some((x: { table: string; flag: string }) => x.table === "call_analyses" && x.flag === "red")).toBe(true);
    expect((await call(s.seller, "GET", `/org/calls/${ids[1]}/log`)).status).toBe(403);
  });
});

describe("coaching", () => {
  it("gives the seller the team's average and the leader each seller day by day", async () => {
    const s = await setup();
    const bench = await call(s.seller, "GET", "/org/dashboard/benchmark", undefined, { from: "2026-09-01", to: "2026-09-07" });
    expect(bench.status).toBe(200);
    // Only two in the team: no average that would reveal a colleague's numbers.
    expect(bench.body).toMatchObject({ from: "2026-09-01", to: "2026-09-07", benchmark: { teamName: "Nord", tooFew: true, perSeller: null } });

    const team = await call(s.leader, "GET", "/org/dashboard/team", undefined, { team: s.team, from: "2026-09-01", to: "2026-09-07" });
    expect(team.status).toBe(200);
    expect(team.body.days).toHaveLength(7);
    expect(team.body.sellers.map((p: { userId: string }) => p.userId)).toContain(s.sellerId);
    expect((await call(s.seller, "GET", "/org/dashboard/team", undefined, { team: s.team })).status).toBe(403);
    expect((await call(s.leader, "GET", "/org/dashboard/team")).status).toBe(403);
    expect((await call(s.leader, "GET", "/org/dashboard/team", undefined, { team: "nope" })).status).toBe(400);
  });

  it("gives compliance the quality dashboard, and nobody without dashboard.all", async () => {
    const s = await setup();
    const compliance = await as(s.org, "compliance");
    const q = await call(compliance, "GET", "/org/dashboard/quality", undefined, { from: "2026-09-01", to: "2026-09-07" });
    expect(q.status).toBe(200);
    expect(q.body).toMatchObject({ from: "2026-09-01", to: "2026-09-07", flags: { open: 0, checked: 0 }, products: [], sellers: [] });
    expect((await call(s.leader, "GET", "/org/dashboard/quality")).status).toBe(403);
    expect((await call(s.seller, "GET", "/org/dashboard/quality")).status).toBe(403);
  });

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
