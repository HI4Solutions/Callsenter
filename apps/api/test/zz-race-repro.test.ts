import { randomBytes } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { expect, it } from "vitest";
import { api, auth, createOrg, member, owner } from "../../../packages/db/test/helpers.ts";
import { createHandler } from "../src/api.ts";
import { sha256 } from "../src/auth/crypto.ts";
import type { AuthDeps } from "../src/auth/types.ts";

const ORIGIN = "https://app.test";
const deps: AuthDeps = { config: { appOrigin: ORIGIN, callbackBase: "https://api.test", providers: {} }, authDb: auth, appDb: api, fetch, now: () => new Date() };
const handler = createHandler({ checkDatabase: async () => true, auth: async () => deps });
async function sessionFor(userId: string, orgId: string) {
  const token = randomBytes(32).toString("base64url");
  await owner.query(`insert into sessions (id_hash, user_id, provider, active_organization_id, expires_at) values ($1,$2,'vipps',$3, now() + interval '1 hour')`, [sha256(token), userId, orgId]);
  return `vq_session=${token}`;
}
async function call(cookie: string, method: string, rawPath: string, body?: unknown) {
  const response = await handler({ rawPath, requestContext: { http: { method, sourceIp: "127.0.0.1", userAgent: "vitest" } }, headers: { origin: ORIGIN }, cookies: [cookie], body: body === undefined ? undefined : JSON.stringify(body) } as unknown as APIGatewayProxyEventV2);
  return { status: response.statusCode, body: response.body ? JSON.parse(String(response.body)) : undefined };
}
it("race", async () => {
  const org = await createOrg();
  const admin = await sessionFor(await member(org, "admin"), org);
  const created = await call(admin, "POST", "/org/products", { name: "X " + randomBytes(3).toString("hex") });
  const id = created.body.id;
  const draftId = (await call(admin, "GET", `/org/products/${id}`)).body.versions[0].id;
  const c = await owner.connect();
  await c.query("begin");
  const del = await c.query("delete from product_template_versions where id = $1", [draftId]);
  console.log("deleted rows", del.rowCount);
  const p = call(admin, "PATCH", `/org/products/${id}/versions/${draftId}`, { terms: "x" }).then((r) => ({ ok: r }), (e) => ({ err: String(e) }));
  await new Promise((r) => setTimeout(r, 500));
  await c.query("commit");
  c.release();
  const result = await p;
  console.log("RESULT", JSON.stringify(result));
});
