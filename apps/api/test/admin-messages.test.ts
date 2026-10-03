import { randomBytes } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { api, auth, createOrg, createUser, makePlatformAdmin, member, owner } from "../../../packages/db/test/helpers.ts";
import { createHandler } from "../src/api.ts";
import { type Email, setMailer } from "../src/email.ts";
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

async function cookieFor(userId: string, provider = "bankid") {
  const token = randomBytes(32).toString("base64url");
  await owner.query(
    `insert into sessions (id_hash, user_id, provider, expires_at) values ($1, $2, $3, now() + interval '1 hour')`,
    [sha256(token), userId, provider],
  );
  return `vq_session=${token}`;
}

async function superadmin() {
  const userId = await createUser("Melding Admin");
  await makePlatformAdmin(userId);
  return cookieFor(userId);
}

async function call(cookie: string, method: string, rawPath: string, options: { body?: unknown; query?: Record<string, string> } = {}) {
  const response = await handler({
    rawPath,
    requestContext: { http: { method, sourceIp: "127.0.0.1", userAgent: "vitest" } },
    headers: { origin: ORIGIN },
    cookies: [cookie],
    queryStringParameters: options.query,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  } as unknown as APIGatewayProxyEventV2);
  return { status: response.statusCode, body: response.body ? JSON.parse(String(response.body)) : undefined };
}

describe("announcements", () => {
  it("reach everyone or selected call centres, and can be switched off", async () => {
    const admin = await superadmin();
    const orgA = await createOrg();
    const orgB = await createOrg();
    const userA = await cookieFor(await member(orgA, "seller"), "vipps");
    const userB = await cookieFor(await member(orgB, "seller"), "vipps");
    const title = `Nyhet ${randomBytes(3).toString("hex")}`;

    const all = await call(admin, "POST", "/admin/announcements", {
      body: { title, body: "Ny funksjon", linkUrl: "https://veriqall.no/nytt", linkText: "Les mer" },
    });
    expect(all.status).toBe(201);
    const selected = await call(admin, "POST", "/admin/announcements", {
      body: { title: `${title} A`, body: "Bare A", audience: "selected", organizationIds: [orgA] },
    });
    expect(selected.status).toBe(201);

    const titles = async (cookie: string) =>
      (await call(cookie, "GET", "/announcements")).body.map((a: { title: string }) => a.title);
    expect(await titles(userA)).toEqual(expect.arrayContaining([title, `${title} A`]));
    expect(await titles(userB)).toContain(title);
    expect(await titles(userB)).not.toContain(`${title} A`);

    await call(admin, "PATCH", `/admin/announcements/${all.body.id}`, { body: { active: false } });
    expect(await titles(userB)).not.toContain(title);

    const list = await call(admin, "GET", "/admin/announcements");
    const a = list.body.find((x: { id: string }) => x.id === selected.body.id);
    expect(a.organizations).toEqual([{ id: orgA, name: expect.any(String) }]);

    expect((await call(admin, "DELETE", `/admin/announcements/${selected.body.id}`)).status).toBe(200);
    expect(await titles(userA)).not.toContain(`${title} A`);
  });

  it("validates input", async () => {
    const admin = await superadmin();
    const post = (body: unknown) => call(admin, "POST", "/admin/announcements", { body });
    expect((await post({ body: "x" })).body.error).toBe("Tittel må fylles ut.");
    expect((await post({ title: "x", body: "y", linkUrl: "http://usikker.no" })).body.error).toBe("Lenken må begynne med https://.");
    expect((await post({ title: "x", body: "y", audience: "selected" })).body.error).toBe("Velg minst ett callsenter.");
    expect((await call(admin, "GET", "/announcements")).status).toBe(200);
    expect((await call("vq_session=nope", "GET", "/announcements")).status).toBe(401);
  });

  it("are only written by superadmins", async () => {
    const org = await createOrg();
    const cookie = await cookieFor(await member(org, "admin"));
    expect((await call(cookie, "POST", "/admin/announcements", { body: { title: "x", body: "y" } })).status).toBe(403);
  });
});

describe("growth", () => {
  it("returns totals, a monthly series and marketing events", async () => {
    const admin = await superadmin();
    await createOrg();
    const today = new Date().toISOString().slice(0, 10);
    const event = await call(admin, "POST", "/admin/growth/events", { body: { title: "Messe", occurredOn: today } });
    expect(event.status).toBe(201);

    const res = await call(admin, "GET", "/admin/growth", { query: { months: "6" } });
    expect(res.status).toBe(200);
    expect(res.body.series).toHaveLength(6);
    expect(res.body.series[5].month).toBe(today.slice(0, 7));
    expect(res.body.series[5].newOrganizations).toBeGreaterThanOrEqual(1);
    expect(res.body.totals.allUsers).toBeGreaterThanOrEqual(1);
    expect(res.body.events.find((e: { id: string }) => e.id === event.body.id)).toMatchObject({ title: "Messe", occurredOn: today });

    expect((await call(admin, "POST", "/admin/growth/events", { body: { title: "x", occurredOn: "i dag" } })).status).toBe(400);
    expect((await call(admin, "DELETE", `/admin/growth/events/${event.body.id}`)).status).toBe(200);
  });
});

describe("contact requests", () => {
  it("come in from the landing page without a session, and superadmins handle them", async () => {
    const admin = await superadmin();
    const name = `Kari ${randomBytes(3).toString("hex")}`;
    const sent = await call("", "POST", "/contact", { body: { name, email: "kari@example.test", company: "Nord", message: "Vi vil se en demo." } });
    expect(sent.status).toBe(201);
    // A bot that fills the hidden field gets the same answer, and nothing is stored.
    const bot = await call("", "POST", "/contact", { body: { name: "Bot", email: "bot@example.test", message: "x", website: "http://spam" } });
    expect(bot.status).toBe(201);
    expect((await call("", "POST", "/contact", { body: { name, email: "not-an-email", message: "x" } })).body.error).toBe("E-postadressen er ugyldig.");
    expect((await call("", "POST", "/contact", { body: { name, email: "a@b.c" } })).status).toBe(400);

    const list = await call(admin, "GET", "/admin/contact-requests");
    expect(list.status).toBe(200);
    expect(list.body.emailEnabled).toBe(false);
    const mine = list.body.requests.find((r: { name: string }) => r.name === name);
    expect(mine).toMatchObject({ email: "kari@example.test", company: "Nord", phone: null, handledAt: null, locale: "nb" });
    expect(list.body.requests.some((r: { name: string }) => r.name === "Bot")).toBe(false);

    const handled = await call(admin, "PATCH", `/admin/contact-requests/${mine.id}`, { body: { handled: true } });
    expect(handled.status).toBe(200);
    expect(handled.body.handledByName).toBe("Melding Admin");
    expect(handled.body.handledAt).toBeTruthy();
    expect((await call(admin, "PATCH", `/admin/contact-requests/${mine.id}`, { body: { handled: false } })).body.handledAt).toBeNull();
  });
});

describe("replies to contact requests", () => {
  it("e-mail the visitor in their language, with the superadmin as Reply-To, and keep the reply", async () => {
    const userId = await createUser("Svar Admin");
    await makePlatformAdmin(userId);
    await owner.query("update users set email = $2 where id = $1", [userId, `svar-${userId.slice(0, 8)}@example.test`]);
    const admin = await cookieFor(userId);
    const name = `Sven ${randomBytes(3).toString("hex")}`;
    await call("", "POST", "/contact", { body: { name, email: "sven@example.test", message: "Kan vi få en demo?\nVi är 40 säljare." } });
    // The visitor wrote in Swedish.
    await owner.query("update contact_requests set locale = 'sv' where name = $1", [name]);
    const id = (await owner.query("select id from contact_requests where name = $1", [name])).rows[0].id;

    setMailer(null);
    expect((await call(admin, "POST", `/admin/contact-requests/${id}/replies`, { body: { message: "Hej!" } })).body.error).toBe("E-post er ikke satt opp.");

    const sent: Email[] = [];
    setMailer(async (email) => {
      sent.push(email);
      return "msg-reply";
    });
    try {
      const replied = await call(admin, "POST", `/admin/contact-requests/${id}/replies`, { body: { message: "Hej Sven, absolut." } });
      expect(replied.status).toBe(201);
      expect(sent[0]).toMatchObject({ to: "sven@example.test", replyTo: `svar-${userId.slice(0, 8)}@example.test`, subject: "Svar på din förfrågan till VeriQall" });
      expect(sent[0]!.text).toContain("Hej Sven, absolut.");
      expect(sent[0]!.text).toContain("> Vi är 40 säljare.");
      expect(replied.body.replies).toHaveLength(1);
      expect(replied.body.replies[0]).toMatchObject({ body: "Hej Sven, absolut.", sentTo: "sven@example.test", sent: true, sentByName: "Svar Admin" });
      // Replying marks the request handled.
      expect(replied.body.handledByName).toBe("Svar Admin");
      expect((await call(admin, "POST", `/admin/contact-requests/${id}/replies`, { body: { message: "" } })).status).toBe(400);
    } finally {
      setMailer(undefined);
    }
  });
});
