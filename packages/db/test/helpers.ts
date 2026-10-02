import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, inject } from "vitest";

const pools: pg.Pool[] = [];
function pool(url: string) {
  const p = new pg.Pool({ connectionString: url, max: 4 });
  pools.push(p);
  return p;
}
afterAll(async () => {
  await Promise.all(pools.splice(0).map((p) => p.end()));
});

// The owner bypasses RLS: used only to build fixtures and to inspect what was written.
export const owner = pool(inject("ownerUrl"));
export const api = pool(inject("apiUrl"));
export const auth = pool(inject("authUrl"));
// The worker Lambda: transcribes, analyses and deletes expired calls, for no particular user.
export const worker = pool(inject("workerUrl"));

export interface Context {
  userId?: string;
  orgId?: string;
  // Session started with BankID (default). false = a Vipps session.
  strong?: boolean;
}

// Runs fn in a transaction the way the API will: SET LOCAL of user and call centre first.
// Rolled back afterwards, so tests do not leak into each other.
export async function as<T>(
  db: pg.Pool,
  context: Context,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query(
      `select set_config('app.current_user_id', $1, true), set_config('app.current_org_id', $2, true),
              set_config('app.session_strong', $3, true)`,
      [context.userId ?? "", context.orgId ?? "", context.strong === false ? "" : "on"],
    );
    return await fn(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

export async function createOrg(name = `Callsenter ${randomUUID().slice(0, 8)}`) {
  const { rows } = await owner.query<{ id: string }>(
    "insert into organizations (name) values ($1) returning id",
    [name],
  );
  return rows[0]!.id;
}

export async function createUser(name = "Test Testesen", status = "active") {
  const { rows } = await owner.query<{ id: string }>(
    "insert into users (full_name, status) values ($1, $2) returning id",
    [name, status],
  );
  return rows[0]!.id;
}

export async function roleId(orgId: string, key: string) {
  const { rows } = await owner.query<{ id: string }>(
    "select id from roles where organization_id = $1 and key = $2",
    [orgId, key],
  );
  if (!rows[0]) throw new Error(`no role ${key} in ${orgId}`);
  return rows[0].id;
}

export async function addMember(orgId: string, userId: string, roleKey: string, status = "active") {
  await owner.query(
    "insert into memberships (organization_id, user_id, role_id, status) values ($1, $2, $3, $4)",
    [orgId, userId, await roleId(orgId, roleKey), status],
  );
}

// A user who is an active member of a new call centre with the given role.
export async function member(orgId: string, roleKey: string) {
  const userId = await createUser();
  await addMember(orgId, userId, roleKey);
  return userId;
}

export async function makePlatformAdmin(userId: string) {
  await owner.query("insert into platform_admins (user_id) values ($1)", [userId]);
}

export const hash32 = () => randomBytes(32);

export async function count(client: pg.PoolClient, table: string) {
  const { rows } = await client.query<{ n: number }>(`select count(*)::int as n from ${table}`);
  return rows[0]!.n;
}

// Expects a statement to fail without aborting the surrounding transaction.
export async function rejects(client: pg.PoolClient, sql: string, params: unknown[], pattern: RegExp) {
  await client.query("savepoint expect_error");
  let error: unknown;
  try {
    await client.query(sql, params);
  } catch (e) {
    error = e;
  }
  await client.query("rollback to savepoint expect_error");
  if (!error) throw new Error(`expected to fail: ${sql}`);
  if (!pattern.test((error as Error).message)) {
    throw new Error(`"${sql}" failed with "${(error as Error).message}", expected ${pattern}`);
  }
}
