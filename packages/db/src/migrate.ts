import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ClientBase } from "pg";

export const MIGRATIONS_DIR = path.join(import.meta.dirname, "../migrations");

// Serializes concurrent runs (two deploys at once) on the same database.
const LOCK_KEY = 7_311_822_011;

const FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

// A migration waits at most this long for a table lock, then tries again a few times. Without
// it, DDL waiting behind a long transaction (the worker holds some for minutes) makes every
// other query on the table queue behind the DDL, and the API stops answering.
export interface MigrateOptions {
  lockTimeoutMs?: number;
  lockAttempts?: number;
  retryDelayMs?: number;
}

export interface Migration {
  version: string;
  sql: string;
  checksum: string;
}

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
  const bad = files.filter((file) => !FILE_PATTERN.test(file));
  if (bad.length > 0) {
    throw new Error(`migration file names must look like 0001_name.sql: ${bad.join(", ")}`);
  }
  return Promise.all(
    files.map(async (file) => {
      const sql = await readFile(path.join(dir, file), "utf8");
      return {
        version: file.replace(/\.sql$/, ""),
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    }),
  );
}

// Applies pending migrations in order, each in its own transaction. Refuses to run if an
// applied migration was edited or removed, or if a new one sorts before the latest applied.
export async function migrate(client: ClientBase, migrations: Migration[], options: MigrateOptions = {}): Promise<string[]> {
  const { lockTimeoutMs = 5000, lockAttempts = 5, retryDelayMs = 2000 } = options;
  await client.query(`
    create table if not exists schema_migrations (
      version text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`);
  await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
  try {
    const { rows } = await client.query<{ version: string; checksum: string }>(
      "select version, checksum from schema_migrations order by version",
    );
    const byVersion = new Map(migrations.map((m) => [m.version, m]));
    for (const row of rows) {
      const migration = byVersion.get(row.version);
      if (!migration) {
        throw new Error(`migration ${row.version} is applied but missing from the repository`);
      }
      if (migration.checksum !== row.checksum) {
        throw new Error(`migration ${row.version} was changed after it was applied`);
      }
    }

    const latest = rows.at(-1)?.version;
    const applied = new Set(rows.map((row) => row.version));
    const pending = migrations.filter((m) => !applied.has(m.version));
    const early = pending.find((m) => latest !== undefined && m.version < latest);
    if (early) {
      throw new Error(`migration ${early.version} sorts before the latest applied (${latest})`);
    }

    const done: string[] = [];
    for (const migration of pending) {
      for (let attempt = 1; ; attempt++) {
        await client.query("begin");
        try {
          await client.query(`set local lock_timeout = ${Math.max(1, Math.round(lockTimeoutMs))}`);
          await client.query(migration.sql);
          await client.query("insert into schema_migrations (version, checksum) values ($1, $2)", [
            migration.version,
            migration.checksum,
          ]);
          await client.query("commit");
          break;
        } catch (error) {
          await client.query("rollback");
          // 55P03: lock_not_available, from lock_timeout. Wait a little and try the whole
          // migration again; it was rolled back.
          if ((error as { code?: string }).code === "55P03" && attempt < lockAttempts) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
            continue;
          }
          throw new Error(`migration ${migration.version} failed: ${(error as Error).message}`, {
            cause: error,
          });
        }
      }
      done.push(migration.version);
    }
    return done;
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
  }
}
