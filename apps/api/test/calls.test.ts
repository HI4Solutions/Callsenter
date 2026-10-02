import { randomBytes } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { api, auth, createOrg, createUser, makePlatformAdmin, member, owner, worker } from "../../../packages/db/test/helpers.ts";
import { createHandler } from "../src/api.ts";
import { sha256 } from "../src/auth/crypto.ts";
import type { AuthDeps } from "../src/auth/types.ts";
import type { Ai } from "../src/calls/ai.ts";
import { housekeeping, processCall, type WorkerDeps } from "../src/calls/process.ts";
import type { CallServices } from "../src/calls/services.ts";
import { Soniox, toSegments } from "../src/calls/soniox.ts";
import type { AudioStore } from "../src/calls/store.ts";

const ORIGIN = "https://app.test";

// In-memory stand-ins for S3, Soniox and Bedrock.
const objects = new Map<string, Uint8Array>();
const store: AudioStore = {
  presignPut: async (key) => `https://s3.test/put/${key}`,
  presignGet: async (key) => `https://s3.test/get/${key}`,
  list: async (prefix) => [...objects].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, size: v.length })),
  get: async (key) => objects.get(key)!,
  put: async (key, body) => void objects.set(key, body),
  delete: async (keys) => keys.forEach((k) => objects.delete(k)),
};
const started: string[] = [];
const sonioxLog: string[] = [];

class FakeSoniox extends Soniox {
  constructor() {
    super("test-key");
  }
  override async temporaryKey(ref: string) {
    sonioxLog.push(`temp:${ref}`);
    return { api_key: "temp:abc", expires_at: new Date(Date.now() + 300_000).toISOString() };
  }
  override async uploadFile(bytes: Uint8Array) {
    sonioxLog.push(`upload:${new TextDecoder().decode(bytes)}`);
    return "file-1";
  }
  override async createTranscription() {
    return "tr-1";
  }
  override async status() {
    return { status: "completed" as const, audio_duration_ms: 65_000 };
  }
  override async transcript() {
    return {
      text: "",
      tokens: [
        { text: "Hei", start_ms: 0, end_ms: 300, speaker: "1" },
        { text: ", dette er Kari fra Strøm AS.", start_ms: 300, end_ms: 2000, speaker: "1" },
        { text: "Ja", start_ms: 3000, end_ms: 3200, speaker: "2" },
        { text: ", hei.", start_ms: 3200, end_ms: 3500, speaker: "2" },
        { text: " Det er helt gratis.", start_ms: 40_000, end_ms: 42_000, speaker: "1" },
      ],
    };
  }
  override async deleteTranscription(id: string) {
    sonioxLog.push(`delete-transcription:${id}`);
  }
  override async deleteFile(id: string) {
    sonioxLog.push(`delete-file:${id}`);
  }
}
const soniox = new FakeSoniox();

const prompts: string[] = [];
const ai: Ai = {
  async structured<T>(_system: string, prompt: string) {
    prompts.push(prompt);
    const pointId = /\[([a-z0-9]+)\] Opplys om angreretten/.exec(prompt)?.[1] ?? "";
    return {
      data: {
        summary: "Selgeren brukte en forbudt formulering og nevnte ikke angreretten.",
        findings: [
          { kind: "required_point", pointId, label: "Angrerett", level: "red", quote: "", startMs: -1, comment: "Ikke nevnt." },
          { kind: "forbidden_phrase", pointId: "", label: "«gratis»", level: "red", quote: "Det er helt gratis.", startMs: 40_000, comment: "" },
        ],
      } as T,
      model: "test-model",
      inputTokens: 1000,
      outputTokens: 200,
    };
  },
  async text(_system, prompt) {
    prompts.push(prompt);
    return { data: "Sammendrag: Kari ringte om fastpris.", model: "test-model", inputTokens: 900, outputTokens: 100 };
  },
};

const services: CallServices = { store, soniox, startWorker: async (id) => void started.push(id) };
const deps: AuthDeps = {
  config: { appOrigin: ORIGIN, callbackBase: "https://api.test", providers: {} },
  authDb: auth,
  appDb: api,
  fetch,
  now: () => new Date(),
  calls: services,
};
const handler = createHandler({ checkDatabase: async () => true, auth: async () => deps });
const workerDeps: WorkerDeps = { db: worker, store, soniox, ai, sleep: async () => undefined, sonioxTimeoutMs: 1000 };

async function sessionFor(userId: string, orgId: string | null, provider = "bankid") {
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

// A call centre with the call modules on and a published product with one mandatory point.
async function setup(modules = ["transcription", "ai_control", "reports"]) {
  const org = await createOrg();
  for (const m of modules) await owner.query("insert into organization_modules (organization_id, module) values ($1, $2)", [org, m]);
  const admin = await sessionFor(await member(org, "admin"), org);
  const product = await call(admin, "POST", "/org/products", { name: "Strøm fastpris" });
  const draft = (await call(admin, "GET", `/org/products/${product.body.id}`)).body.versions[0].id;
  await call(admin, "PATCH", `/org/products/${product.body.id}/versions/${draft}`, {
    priceMonthly: "399",
    terms: "Vilkår",
    requiredPoints: ["Opplys om angreretten"],
    forbiddenPhrases: ["gratis"],
  });
  await call(admin, "POST", `/org/products/${product.body.id}/versions/${draft}/publish`);
  return { org, admin, productId: product.body.id as string };
}

// Records a call the way the browser does: create, upload two chunks, complete.
async function record(cookie: string, body: Record<string, unknown>) {
  const created = await call(cookie, "POST", "/org/calls", { source: "tab", mime: "audio/webm;codecs=opus", ...body });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  for (const [seq, text] of ["del1-", "del2"].entries()) {
    const chunk = await call(cookie, "POST", `/org/calls/${id}/chunks`, { seq });
    expect(chunk.status).toBe(200);
    objects.set(chunk.body.url.replace("https://s3.test/put/", ""), new TextEncoder().encode(text));
  }
  expect((await call(cookie, "POST", `/org/calls/${id}/complete`, { durationMs: 64_000 })).status).toBe(200);
  return { id, created: created.body };
}

describe("calls: recording to report", () => {
  it("records in realtime mode, transcribes, checks against the template and writes a report", async () => {
    const s = await setup();
    const sellerId = await member(s.org, "seller");
    const seller = await sessionFor(sellerId, s.org, "vipps");
    const { id, created } = await record(seller, { productId: s.productId, title: "Kari, fastpris" });
    expect(created).toMatchObject({ mode: "realtime", realtime: { apiKey: "temp:abc", model: "stt-rt-v5", languageHints: ["no"] } });
    expect(started).toContain(id);

    await processCall(workerDeps, id);
    // The chunks are joined into one recording, and nothing is left at Soniox.
    expect(sonioxLog).toContain("upload:del1-del2");
    expect(sonioxLog).toEqual(expect.arrayContaining(["delete-transcription:tr-1", "delete-file:file-1"]));
    expect([...objects.keys()].filter((k) => k.includes(id))).toEqual([`${s.org}/${id}/audio`]);
    // The model sees the template and the transcript with timestamps.
    expect(prompts.at(-2)).toContain("Forbudte formuleringer:\n- gratis");
    expect(prompts.at(-2)).toContain("[00:40] Taler 1: Det er helt gratis.");

    const detail = await call(seller, "GET", `/org/calls/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ status: "analyzed", flag: "red", durationMs: 65_000, productName: "Strøm fastpris", templateVersion: 1 });
    expect(detail.body.segments.map((x: { speaker: string; text: string }) => [x.speaker, x.text])).toEqual([
      ["1", "Hei, dette er Kari fra Strøm AS."],
      ["2", "Ja, hei."],
      ["1", "Det er helt gratis."],
    ]);
    expect(detail.body.analyses[0].findings[1]).toMatchObject({ level: "red", quote: "Det er helt gratis.", startMs: 40_000 });
    expect(detail.body.reports[0]).toMatchObject({ templateName: "Standardrapport", content: "Sammendrag: Kari ringte om fastpris." });

    const audio = await call(seller, "GET", `/org/calls/${id}/audio`);
    expect(audio.body.url).toBe(`https://s3.test/get/${s.org}/${id}/audio`);
    const log = await owner.query("select action from access_log where resource_type = 'call' and resource_id = $1 order by id", [id]);
    expect(log.rows.map((r) => r.action)).toEqual(["view", "play"]);
    const usage = await owner.query("select kind from usage_events where call_id = $1 order by kind", [id]);
    expect(usage.rows.map((r) => r.kind)).toEqual(["ai_control", "report", "transcription_async", "transcription_realtime"]);

    // Full-text search finds it, and the review list shows the red flag until a leader reviews it.
    const found = await call(seller, "GET", "/org/calls", undefined, { q: "gratis" });
    expect(found.body.map((c: { id: string }) => c.id)).toEqual([id]);
    expect(found.body[0].match).toContain("«gratis»");
    const admin = s.admin;
    expect((await call(admin, "GET", "/org/calls", undefined, { review: "1" })).body).toHaveLength(1);
    const analysisId = detail.body.analyses[0].id;
    expect((await call(seller, "PATCH", `/org/calls/${id}/analyses/${analysisId}`, { reviewNote: "Nei" })).status).toBe(403);
    expect((await call(admin, "PATCH", `/org/calls/${id}/analyses/${analysisId}`, { reviewNote: "Tatt opp med selger" })).status).toBe(200);
    expect((await call(admin, "GET", "/org/calls", undefined, { review: "1" })).body).toHaveLength(0);
  });

  it("transcribes without AI control when no product is linked, and checks it once one is", async () => {
    const s = await setup();
    const seller = await sessionFor(await member(s.org, "seller"), s.org);
    const { id } = await record(seller, {});
    await processCall(workerDeps, id);
    let detail = await call(seller, "GET", `/org/calls/${id}`);
    expect(detail.body.status).toBe("analyzed");
    expect(detail.body.analyses).toEqual([]);
    expect(detail.body.reports).toHaveLength(1);

    // Without the AI modules the call stops at transcribed; linking a product then starts the
    // worker so the AI control can run once the modules are on.
    const plain = await setup(["transcription"]);
    const seller2 = await sessionFor(await member(plain.org, "seller"), plain.org);
    const second = await record(seller2, {});
    await processCall(workerDeps, second.id);
    expect((await call(seller2, "GET", `/org/calls/${second.id}`)).body.status).toBe("transcribed");
    started.length = 0;
    expect((await call(seller2, "PATCH", `/org/calls/${second.id}`, { productId: plain.productId })).status).toBe(200);
    expect(started).toEqual([second.id]);
    detail = await call(seller2, "GET", `/org/calls/${second.id}`);
    expect(detail.body.templateVersion).toBe(1);
  });
});

describe("calls: access", () => {
  it("keeps calls to their recorder (or team, or all), and chunks to the recorder", async () => {
    const s = await setup();
    const seller = await sessionFor(await member(s.org, "seller"), s.org);
    const other = await sessionFor(await member(s.org, "seller"), s.org);
    const created = await call(seller, "POST", "/org/calls", { source: "microphone", mime: "audio/webm" });
    const id = created.body.id;
    expect((await call(other, "GET", `/org/calls/${id}`)).status).toBe(404);
    expect((await call(other, "POST", `/org/calls/${id}/chunks`, { seq: 0 })).status).toBe(404);
    expect((await call(seller, "POST", `/org/calls/${id}/complete`, {})).body.error).toBe("Ingen lyd er lastet opp.");
    const compliance = await sessionFor(await member(s.org, "compliance"), s.org);
    expect((await call(compliance, "POST", "/org/calls", { source: "upload", mime: "audio/mpeg" })).status).toBe(403);

    const stranger = await sessionFor(await member((await setup()).org, "admin"), null);
    expect((await call(stranger, "GET", `/org/calls/${id}`)).status).toBe(400);
  });

  it("refuses recording when transcription is off, and unknown audio types", async () => {
    const s = await setup([]);
    const seller = await sessionFor(await member(s.org, "seller"), s.org);
    const off = await call(seller, "POST", "/org/calls", { source: "microphone", mime: "audio/webm" });
    expect(off.body.error).toBe("Transkribering er ikke slått på for callsenteret.");
    const on = await setup();
    const seller2 = await sessionFor(await member(on.org, "seller"), on.org);
    expect((await call(seller2, "POST", "/org/calls", { source: "microphone", mime: "text/html" })).body.error).toBe("Ukjent lydformat.");
  });
});

describe("calls: settings, retention and housekeeping", () => {
  it("lets superadmins choose chunked mode, the word list and retention per call centre", async () => {
    const s = await setup();
    const superadmin = await createUser();
    await makePlatformAdmin(superadmin);
    const cookie = await sessionFor(superadmin, null);
    expect((await call(cookie, "PATCH", "/admin/system", { transcriptionMode: "chunked", transcriptionTerms: ["VeriQall", " Strøm AS "] })).status).toBe(
      200,
    );
    expect((await call(cookie, "GET", "/admin/system")).body).toMatchObject({ transcriptionMode: "chunked", transcriptionTerms: ["VeriQall", "Strøm AS"] });
    expect((await call(cookie, "PATCH", `/admin/organizations/${s.org}`, { recordingRetentionMonths: 5 })).status).toBe(400);
    expect((await call(cookie, "PATCH", `/admin/organizations/${s.org}`, { recordingRetentionMonths: 6 })).status).toBe(200);

    const seller = await sessionFor(await member(s.org, "seller"), s.org);
    const created = await call(seller, "POST", "/org/calls", { source: "tab", mime: "audio/webm" });
    expect(created.body).toMatchObject({ mode: "chunked", realtime: null });
    const months = (new Date(created.body.expiresAt).getTime() - Date.now()) / (30.4 * 24 * 3600 * 1000);
    expect(Math.round(months)).toBe(6);
    await call(cookie, "PATCH", "/admin/system", { transcriptionMode: "realtime" });
  });

  it("deletes expired calls with their audio, and finishes abandoned recordings", async () => {
    const s = await setup();
    const seller = await sessionFor(await member(s.org, "seller"), s.org);
    const { id } = await record(seller, {});
    await processCall(workerDeps, id);
    await owner.query("update calls set expires_at = now() - interval '1 second' where id = $1", [id]);
    expect((await call(seller, "GET", `/org/calls/${id}`)).status).toBe(404);

    const abandoned = await call(seller, "POST", "/org/calls", { source: "microphone", mime: "audio/webm" });
    const chunk = await call(seller, "POST", `/org/calls/${abandoned.body.id}/chunks`, { seq: 0 });
    objects.set(chunk.body.url.replace("https://s3.test/put/", ""), new TextEncoder().encode("rest"));
    await owner.query("update calls set last_chunk_at = now() - interval '4 hours' where id = $1", [abandoned.body.id]);

    const next = await housekeeping(workerDeps);
    expect((await owner.query("select 1 from calls where id = $1", [id])).rowCount).toBe(0);
    expect([...objects.keys()].some((k) => k.includes(id))).toBe(false);
    expect(next).toContain(abandoned.body.id);
  });

  it("uses the call centre's default report template", async () => {
    const s = await setup(["transcription", "reports"]);
    const created = await call(s.admin, "POST", "/org/report-templates", { name: "Kort", instructions: "Tre setninger.", isDefault: true });
    expect(created.status).toBe(201);
    const seller = await sessionFor(await member(s.org, "seller"), s.org);
    expect((await call(seller, "POST", "/org/report-templates", { name: "Nei", instructions: "Nei" })).status).toBe(403);
    const { id } = await record(seller, {});
    await processCall(workerDeps, id);
    expect(prompts.at(-1)).toContain("Tre setninger.");
    const detail = await call(seller, "GET", `/org/calls/${id}`);
    expect(detail.body.reports[0].templateName).toBe("Kort");
  });
});

describe("toSegments", () => {
  it("splits on speaker changes and long pauses after a sentence", () => {
    expect(
      toSegments([
        { text: "Hei.", start_ms: 0, end_ms: 400, speaker: "1" },
        { text: " Ett", start_ms: 2000, end_ms: 2200, speaker: "1" },
        { text: " øyeblikk", start_ms: 2200, end_ms: 2600, speaker: "1" },
        { text: "<end>" },
        { text: "Ok", start_ms: 3000, end_ms: 3100, speaker: "2" },
      ]).map((x) => [x.speaker, x.startMs, x.text]),
    ).toEqual([
      ["1", 0, "Hei."],
      ["1", 2000, "Ett øyeblikk"],
      ["2", 3000, "Ok"],
    ]);
  });
});
