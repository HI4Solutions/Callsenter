import { describe, expect, it } from "vitest";
import { loadMigrations, migrate } from "../src/migrate.ts";
import { owner } from "./helpers.ts";

// A new migration that needs an exclusive lock on a table someone else is reading from.
async function withReader(fn: (release: () => Promise<void>) => Promise<void>) {
  await owner.query("create table if not exists migrate_lock_probe (id int)");
  const reader = await owner.connect();
  await reader.query("begin");
  await reader.query("lock table migrate_lock_probe in access share mode");
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await reader.query("rollback");
  };
  try {
    await fn(release);
  } finally {
    await release();
    reader.release();
    await owner.query("delete from schema_migrations where version = '9999_lock_probe'");
    await owner.query("drop table if exists migrate_lock_probe");
  }
}

const probe = { version: "9999_lock_probe", sql: "alter table migrate_lock_probe add column note text", checksum: "probe" };
const fast = { lockTimeoutMs: 100, lockAttempts: 3, retryDelayMs: 50 };

describe("migrate", () => {
  it("applies nothing the second time", async () => {
    const client = await owner.connect();
    try {
      expect(await migrate(client, await loadMigrations())).toEqual([]);
    } finally {
      client.release();
    }
  });

  it("refuses to run when an applied migration was edited", async () => {
    const migrations = await loadMigrations();
    const edited = migrations.map((m, i) => (i === 0 ? { ...m, checksum: "edited" } : m));
    const client = await owner.connect();
    try {
      await expect(migrate(client, edited)).rejects.toThrow(/changed after it was applied/);
    } finally {
      client.release();
    }
  });

  it("refuses a new migration that sorts before the latest applied", async () => {
    const migrations = await loadMigrations();
    const early = { version: "0000_backdated", sql: "select 1", checksum: "x" };
    const client = await owner.connect();
    try {
      await expect(migrate(client, [early, ...migrations])).rejects.toThrow(/sorts before/);
    } finally {
      client.release();
    }
  });

  it("gives up waiting for a lock instead of blocking everyone else", async () => {
    await withReader(async () => {
      const client = await owner.connect();
      try {
        const started = Date.now();
        await expect(migrate(client, [...(await loadMigrations()), probe], fast)).rejects.toThrow(/9999_lock_probe failed: .*lock/);
        expect(Date.now() - started).toBeLessThan(5000);
        const { rows } = await owner.query("select 1 from schema_migrations where version = '9999_lock_probe'");
        expect(rows).toHaveLength(0);
      } finally {
        client.release();
      }
    });
  });

  it("tries again and succeeds when the lock is freed", async () => {
    await withReader(async (release) => {
      const client = await owner.connect();
      try {
        setTimeout(() => void release(), 150);
        expect(await migrate(client, [...(await loadMigrations()), probe], { ...fast, lockAttempts: 10 })).toEqual(["9999_lock_probe"]);
      } finally {
        client.release();
      }
    });
  });
});
