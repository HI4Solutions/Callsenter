import { randomBytes } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it } from "vitest";
import { api, auth, createOrg, createUser, makePlatformAdmin, member, owner, worker } from "../../../packages/db/test/helpers.ts";
import { createHandler } from "../src/api.ts";
import { sha256 } from "../src/auth/crypto.ts";
import type { AuthDeps } from "../src/auth/types.ts";
import type { Ai } from "../src/calls/ai.ts";
import { housekeeping, pendingReports, processCall, processPiece, processReport, type WorkerDeps } from "../src/calls/process.ts";
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
const models: string[] = [];
const ai: Ai = {
  async structured<T>(model: string, _system: string, prompt: string) {
    models.push(model);
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
  async text(model, _system, prompt) {
    models.push(model);
    prompts.push(prompt);
    return { data: "Sammendrag: Kari ringte om fastpris.", model: "test-model", inputTokens: 900, outputTokens: 100 };
  },
};

const startedNotes: string[] = [];
const startedPieces: string[] = [];
const services: CallServices = {
  store,
  soniox,
  startPiece: async (id, seq) => void startedPieces.push(`${id}:${seq}`),
  startWorker: async (id, reportId) => {
    if (id) started.push(id);
    if (reportId) startedNotes.push(reportId);
  },
};
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
    const chunk = await call(cookie, "POST", `/org/calls/${id}/chunks`, { seq, size: 1000 });
    expect(chunk.status).toBe(200);
    objects.set(chunk.body.url.replace("https://s3.test/put/", ""), new TextEncoder().encode(text));
  }
  expect((await call(cookie, "POST", `/org/calls/${id}/complete`, { durationMs: 64_000 })).status).toBe(200);
  return { id, created: created.body };
}

// Most of these tests use realtime mode; transcription in pieces sets its own.
beforeEach(async () => {
  await owner.query(`update platform_settings set value = '"realtime"' where key = 'transcription_mode'`);
});

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
    expect(detail.body.reports[0]).toMatchObject({ templateName: "Standardnotat", content: "Sammendrag: Kari ringte om fastpris." });

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
    // Search excerpts are transcript views too.
    const searchLog = await owner.query("select 1 from access_log where resource_type = 'call_search' and resource_id = $1", [id]);
    expect(searchLog.rowCount).toBe(1);
    // The reference number finds it too, however it is typed.
    expect(detail.body.reference).toMatch(/^VQ-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const typed = detail.body.reference.toLowerCase().replace(/-/g, " ").replace("vq ", "");
    const byReference = await call(seller, "GET", "/org/calls", undefined, { q: typed });
    expect(byReference.body.map((c: { id: string }) => c.id)).toEqual([id]);
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
    // A call with only a report can still be linked, and then gets its AI control (not a second report).
    started.length = 0;
    expect((await call(seller, "PATCH", `/org/calls/${id}`, { productId: s.productId })).status).toBe(200);
    expect(started).toEqual([id]);
    await processCall(workerDeps, id);
    detail = await call(seller, "GET", `/org/calls/${id}`);
    expect(detail.body.analyses).toHaveLength(1);
    expect(detail.body.reports).toHaveLength(1);
    expect((await call(seller, "PATCH", `/org/calls/${id}`, { productId: null })).body.error).toBe(
      "En samtale som er sjekket av AI, kan ikke kobles om.",
    );

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

describe("calls: transcription in pieces", () => {
  // Records like the browser in the default mode: the continuous recording in chunks, and a
  // complete file every 15 seconds for transcription while the call goes on.
  async function recordInPieces(cookie: string, pieces: number, body: Record<string, unknown> = {}) {
    const created = await call(cookie, "POST", "/org/calls", { source: "tab", mime: "audio/webm", ...body });
    expect(created.body).toMatchObject({ mode: "chunked", realtime: null });
    const id = created.body.id as string;
    for (let seq = 0; seq < pieces; seq++) {
      const piece = await call(cookie, "POST", `/org/calls/${id}/pieces`, { seq, startMs: seq * 15_000, size: 1000 });
      expect(piece.status).toBe(200);
      objects.set(piece.body.url.replace("https://s3.test/put/", ""), new TextEncoder().encode(`bit${seq}`));
      expect((await call(cookie, "POST", `/org/calls/${id}/pieces/${seq}/uploaded`)).status).toBe(200);
      expect(startedPieces).toContain(`${id}:${seq}`);
    }
    const chunk = await call(cookie, "POST", `/org/calls/${id}/chunks`, { seq: 0, size: 1000 });
    objects.set(chunk.body.url.replace("https://s3.test/put/", ""), new TextEncoder().encode("helt-opptak"));
    return id;
  }

  it("is the default, shows the text while recording and uses the pieces as the transcript", async () => {
    await owner.query(`update platform_settings set value = '"chunked"' where key = 'transcription_mode'`);
    const s = await setup();
    const seller = await sessionFor(await member(s.org, "seller"), s.org);
    const id = await recordInPieces(seller, 2, { productId: s.productId });
    await processPiece(workerDeps, id, 0);
    await processPiece(workerDeps, id, 1);
    // The text so far, with times from the start of the recording; the piece audio is gone.
    const live = (await call(seller, "GET", `/org/calls/${id}/pieces`)).body;
    expect(live.map((p: { status: string }) => p.status)).toEqual(["done", "done"]);
    expect(live[1].segments[0]).toMatchObject({ startMs: 15_000, text: "Hei, dette er Kari fra Strøm AS." });
    expect([...objects.keys()].some((k) => k.includes(`${id}/pieces/`))).toBe(false);
    // Only new pieces after the last one seen.
    expect((await call(seller, "GET", `/org/calls/${id}/pieces`, undefined, { after: "0" })).body).toHaveLength(1);

    sonioxLog.length = 0;
    expect((await call(seller, "POST", `/org/calls/${id}/complete`, { durationMs: 30_000, pieces: 2 })).status).toBe(200);
    await processCall(workerDeps, id);
    // No second transcription of the whole recording; it is still stored for playback.
    expect(sonioxLog.some((l) => l.startsWith("upload:"))).toBe(false);
    const detail = (await call(seller, "GET", `/org/calls/${id}`)).body;
    expect(detail).toMatchObject({ status: "analyzed", hasAudio: true, durationMs: 30_000 });
    expect(detail.segments.map((x: { startMs: number }) => x.startMs)).toEqual([0, 3000, 40_000, 15_000, 18_000, 55_000]);
    expect(detail.reports).toHaveLength(1);
    const usage = await owner.query("select count(*)::int as n from usage_events where call_id = $1 and kind = 'transcription_async'", [id]);
    expect(usage.rows[0].n).toBe(2);
  });

  it("transcribes the whole recording when a piece is missing", async () => {
    await owner.query(`update platform_settings set value = '"chunked"' where key = 'transcription_mode'`);
    const s = await setup();
    const seller = await sessionFor(await member(s.org, "seller"), s.org);
    const id = await recordInPieces(seller, 1);
    await processPiece(workerDeps, id, 0);
    sonioxLog.length = 0;
    // The browser made three pieces, but only one reached the server.
    await call(seller, "POST", `/org/calls/${id}/complete`, { pieces: 3 });
    await processCall(workerDeps, id);
    expect(sonioxLog).toContain("upload:helt-opptak");
    expect((await call(seller, "GET", `/org/calls/${id}`)).body.status).toBe("analyzed");
  });

  it("keeps pieces to the recorder while recording", async () => {
    await owner.query(`update platform_settings set value = '"chunked"' where key = 'transcription_mode'`);
    const s = await setup();
    const seller = await sessionFor(await member(s.org, "seller"), s.org);
    const other = await sessionFor(await member(s.org, "seller"), s.org);
    const created = await call(seller, "POST", "/org/calls", { source: "microphone", mime: "audio/webm" });
    expect((await call(other, "POST", `/org/calls/${created.body.id}/pieces`, { seq: 0, startMs: 0, size: 1000 })).status).toBe(404);
    expect((await call(other, "GET", `/org/calls/${created.body.id}/pieces`)).status).toBe(404);
    expect((await call(seller, "POST", `/org/calls/${created.body.id}/pieces`, { seq: 0, startMs: -1, size: 1000 })).status).toBe(400);
  });
});

describe("calls: studio", () => {
  it("uses the seller's additional information for the note but never for the AI control", async () => {
    const s = await setup();
    const seller = await sessionFor(await member(s.org, "seller"), s.org);
    const created = await call(seller, "POST", "/org/calls", { source: "tab", mime: "audio/webm", productId: s.productId });
    const id = created.body.id as string;
    expect((await call(seller, "PATCH", `/org/calls/${id}`, { note: "Kunden har avtale med Fjordkraft til mars." })).status).toBe(200);
    const chunk = await call(seller, "POST", `/org/calls/${id}/chunks`, { seq: 0, size: 1000 });
    objects.set(chunk.body.url.replace("https://s3.test/put/", ""), new TextEncoder().encode("lyd"));
    await call(seller, "POST", `/org/calls/${id}/complete`, {});
    prompts.length = 0;
    await processCall(workerDeps, id);
    expect(prompts[0]).not.toContain("Fjordkraft");
    expect(prompts[1]).toContain("<additional_information>\nKunden har avtale med Fjordkraft til mars.");
    const detail = await call(seller, "GET", `/org/calls/${id}`);
    expect(detail.body).toMatchObject({ isOwn: true, note: "Kunden har avtale med Fjordkraft til mars." });
    expect(detail.body.requiredPoints).toEqual([expect.objectContaining({ text: "Opplys om angreretten" })]);
  });

  it("makes another note with another template, lets the seller adjust it and keeps the AI text", async () => {
    const s = await setup();
    const sellerId = await member(s.org, "seller");
    const seller = await sessionFor(sellerId, s.org);
    const { id } = await record(seller, { productId: s.productId });
    // Not before the call is transcribed.
    expect((await call(seller, "POST", `/org/calls/${id}/notes`, {})).body.error).toBe("Samtalen er ikke ferdig transkribert ennå.");
    await processCall(workerDeps, id);

    const template = await call(s.admin, "POST", "/org/report-templates", { name: "Kort notat", instructions: "Tre linjer." });
    const asked = await call(seller, "POST", `/org/calls/${id}/notes`, { templateIds: [template.body.id] });
    expect(asked.status).toBe(201);
    const askedId = asked.body.ids[0] as string;
    expect(startedNotes).toContain(askedId);
    expect((await call(seller, "POST", `/org/calls/${id}/notes`, { templateIds: ["00000000-0000-4000-8000-000000000000"] })).body.error).toBe(
      "Ukjent notatmal.",
    );
    let status = await call(seller, "GET", `/org/calls/${id}`, undefined, { status: "1" });
    expect(status.body).toMatchObject({ reports: 1, pendingReports: 1 });

    prompts.length = 0;
    await processReport(workerDeps, askedId);
    expect(prompts[0]).toContain("<report_instructions>\nTre linjer.");
    status = await call(seller, "GET", `/org/calls/${id}`, undefined, { status: "1" });
    expect(status.body).toMatchObject({ reports: 2, pendingReports: 0 });

    const note = (await call(seller, "GET", `/org/calls/${id}`)).body.reports[0];
    expect(note).toMatchObject({ templateName: "Kort notat", status: "done", edits: 0, requestedByName: expect.any(String) });
    const edited = await call(seller, "PATCH", `/org/calls/${id}/notes/${note.id}`, { content: "Kari takket ja til fastpris." });
    expect(edited.body).toMatchObject({ changed: true });
    // Saving the same text again adds nothing.
    expect((await call(seller, "PATCH", `/org/calls/${id}/notes/${note.id}`, { content: "Kari takket ja til fastpris." })).body).toMatchObject({
      changed: false,
    });
    const after = (await call(s.admin, "GET", `/org/calls/${id}`)).body.reports[0];
    expect(after).toMatchObject({ content: "Kari takket ja til fastpris.", aiContent: "Sammendrag: Kari ringte om fastpris.", edits: 1 });
    // A leader sees the note and its history, but only the seller adjusts it.
    expect((await call(s.admin, "PATCH", `/org/calls/${id}/notes/${note.id}`, { content: "Endret" })).body.error).toBe(
      "Bare selgeren som hadde samtalen, kan endre notatet.",
    );
    const history = await call(s.admin, "GET", `/org/calls/${id}/notes/${note.id}/history`);
    expect(history.body.map((h: { ai: boolean }) => h.ai)).toEqual([false, true]);
    // A colleague cannot ask for notes on someone else's call.
    const colleague = await sessionFor(await member(s.org, "seller"), s.org);
    expect((await call(colleague, "POST", `/org/calls/${id}/notes`, {})).status).toBe(404);
  });

  it("fails a note when the modules are off, and picks up notes whose worker never started", async () => {
    const s = await setup();
    const seller = await sessionFor(await member(s.org, "seller"), s.org);
    const { id } = await record(seller, {});
    await processCall(workerDeps, id);
    const asked = (await call(seller, "POST", `/org/calls/${id}/notes`, {})).body.ids[0] as string;
    await owner.query("update reports set created_at = now() - interval '5 minutes' where id = $1", [asked]);
    expect(await pendingReports(worker)).toContain(asked);
    await owner.query("update organization_modules set enabled = false where organization_id = $1 and module = 'reports'", [s.org]);
    await processReport(workerDeps, asked);
    const note = (await call(seller, "GET", `/org/calls/${id}`)).body.reports.find((r: { id: string }) => r.id === asked);
    expect(note).toMatchObject({ status: "failed", error: "Rapporter er ikke slått på for callsenteret." });
    expect((await call(seller, "POST", `/org/calls/${id}/notes`, {})).body.code).toBe("modul_av");
  });

  it("writes one note per note template chosen in the studio", async () => {
    const s = await setup();
    const seller = await sessionFor(await member(s.org, "seller"), s.org);
    const first = await call(s.admin, "POST", "/org/report-templates", { name: "Kundenotat", instructions: "Til kunden." });
    const second = await call(s.admin, "POST", "/org/report-templates", { name: "Ledernotat", instructions: "Til lederen." });
    expect((await call(seller, "POST", "/org/calls", { source: "tab", mime: "audio/webm", noteTemplateIds: ["x"] })).status).toBe(400);
    const { id } = await record(seller, { noteTemplateIds: [first.body.id] });
    // Changed while recording or before the call is processed.
    expect((await call(seller, "PATCH", `/org/calls/${id}`, { noteTemplateIds: [second.body.id, first.body.id] })).status).toBe(200);
    prompts.length = 0;
    await processCall(workerDeps, id);
    const detail = (await call(seller, "GET", `/org/calls/${id}`)).body;
    expect(detail.noteTemplateIds).toEqual([second.body.id, first.body.id]);
    expect(detail.reports.map((r: { templateName: string }) => r.templateName).sort()).toEqual(["Kundenotat", "Ledernotat"]);
    expect(prompts.filter((p) => p.includes("Til lederen."))).toHaveLength(1);
    // "Regenerer" with both gives two more.
    const again = await call(seller, "POST", `/org/calls/${id}/notes`, { templateIds: [first.body.id, second.body.id] });
    expect(again.body.ids).toHaveLength(2);
  });

  it("remembers each member's default product", async () => {
    const s = await setup();
    const seller = await sessionFor(await member(s.org, "seller"), s.org);
    expect((await call(seller, "GET", "/org/studio")).body).toEqual({ productId: null });
    expect((await call(seller, "PUT", "/org/studio", { productId: s.productId })).status).toBe(200);
    expect((await call(seller, "GET", "/org/studio")).body).toEqual({ productId: s.productId });
    expect((await call(seller, "PUT", "/org/studio", { productId: null })).status).toBe(200);
    expect((await call(seller, "GET", "/org/studio")).body).toEqual({ productId: null });
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
    expect((await call(other, "POST", `/org/calls/${id}/chunks`, { seq: 0, size: 1000 })).status).toBe(404);
    // The size is signed into the upload URL, so it must be given and within the limit.
    expect((await call(seller, "POST", `/org/calls/${id}/chunks`, { seq: 0 })).status).toBe(400);
    expect((await call(seller, "POST", `/org/calls/${id}/chunks`, { seq: 0, size: 201 * 1024 * 1024 })).body.error).toMatch(/for stor/);
    expect((await call(seller, "POST", `/org/calls/${id}/pieces`, { seq: 0, startMs: 0, size: 11 * 1024 * 1024 })).status).toBe(400);
    expect((await call(seller, "POST", `/org/calls/${id}/complete`, { durationMs: 25 * 3600_000 })).body.error).toBe("Ugyldig varighet.");
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
    expect((await call(cookie, "GET", "/admin/system")).body).toMatchObject({
      transcriptionMode: "chunked",
      transcriptionTerms: ["VeriQall", "Strøm AS"],
      aiModel: "sonnet-4-6",
    });
    expect((await call(cookie, "PATCH", "/admin/system", { aiModel: "gpt-5" })).body.error).toBe("Ukjent AI-modell.");
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
    const chunk = await call(seller, "POST", `/org/calls/${abandoned.body.id}/chunks`, { seq: 0, size: 1000 });
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
    const superadmin = await createUser();
    await makePlatformAdmin(superadmin);
    const cookie = await sessionFor(superadmin, null);
    expect((await call(cookie, "PATCH", "/admin/system", { aiModel: "haiku-4-5" })).status).toBe(200);
    await processCall(workerDeps, id);
    await call(cookie, "PATCH", "/admin/system", { aiModel: "sonnet-4-6" });
    expect(prompts.at(-1)).toContain("Tre setninger.");
    expect(models.at(-1)).toBe("eu.anthropic.claude-haiku-4-5-20251001-v1:0");
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

describe("calls: robustness", () => {
  it("retries a call that failed in the AI step without transcribing it again", async () => {
    const s = await setup();
    const seller = await sessionFor(await member(s.org, "seller"), s.org);
    const { id } = await record(seller, { productId: s.productId });
    const failing: Ai = { ...ai, structured: async () => Promise.reject(new Error("bedrock down")) };
    await processCall({ ...workerDeps, ai: failing }, id);
    expect((await call(seller, "GET", `/org/calls/${id}`)).body).toMatchObject({ status: "failed", error: "AI-kontrollen feilet. Prøv igjen." });
    const uploads = sonioxLog.filter((l) => l.startsWith("upload:")).length;
    expect((await call(seller, "POST", `/org/calls/${id}/retry`)).status).toBe(200);
    await processCall(workerDeps, id);
    expect(sonioxLog.filter((l) => l.startsWith("upload:")).length).toBe(uploads);
    expect((await call(seller, "GET", `/org/calls/${id}`)).body.status).toBe("analyzed");
    const usage = await owner.query("select kind from usage_events where call_id = $1 and kind like 'transcription%' order by kind", [id]);
    expect(usage.rows.map((r) => r.kind)).toEqual(["transcription_async", "transcription_realtime"]);
  });

  it("checks a call once when the note fails after the AI control, and writes only the missing note", async () => {
    const s = await setup();
    const seller = await sessionFor(await member(s.org, "seller"), s.org);
    const { id } = await record(seller, { productId: s.productId });
    const noteDown: Ai = { ...ai, text: async () => Promise.reject(new Error("bedrock down")) };
    await processCall({ ...workerDeps, ai: noteDown }, id);
    expect((await call(seller, "GET", `/org/calls/${id}`)).body.status).toBe("failed");
    expect((await call(seller, "POST", `/org/calls/${id}/retry`)).status).toBe(200);
    await processCall(workerDeps, id);
    const detail = (await call(seller, "GET", `/org/calls/${id}`)).body;
    expect(detail.status).toBe("analyzed");
    expect(detail.analyses).toHaveLength(1);
    expect(detail.reports).toHaveLength(1);
    const usage = await owner.query("select kind from usage_events where call_id = $1 and kind in ('ai_control', 'report') order by kind", [id]);
    expect(usage.rows.map((r) => r.kind)).toEqual(["ai_control", "report"]);
  });

  it("caps realtime keys and refuses them for chunked calls", async () => {
    const s = await setup();
    const seller = await sessionFor(await member(s.org, "seller"), s.org);
    const created = await call(seller, "POST", "/org/calls", { source: "tab", mime: "audio/webm" });
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await call(seller, "POST", `/org/calls/${created.body.id}/realtime-key`)).status);
    // One key at creation and four renewals; the fifth renewal is refused.
    expect(statuses).toEqual([200, 200, 200, 200, 503, 503]);
    const upload = await call(seller, "POST", "/org/calls", { source: "upload", mime: "audio/mpeg" });
    expect((await call(seller, "POST", `/org/calls/${upload.body.id}/realtime-key`)).status).toBe(503);
  });

  it("picks up calls the worker was never started for, and gives up after three runs", async () => {
    const s = await setup();
    const seller = await sessionFor(await member(s.org, "seller"), s.org);
    const { id } = await record(seller, {});
    await owner.query("update calls set processing_started_at = now() - interval '11 minutes' where id = $1", [id]);
    expect(await housekeeping(workerDeps)).toContain(id);
    await owner.query("update calls set attempts = 3 where id = $1", [id]);
    await processCall(workerDeps, id);
    expect((await call(seller, "GET", `/org/calls/${id}`)).body).toMatchObject({
      status: "failed",
      error: "Behandlingen feilet flere ganger. Prøv igjen senere.",
    });
  });
});
