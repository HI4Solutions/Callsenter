import { describe, expect, it } from "vitest";
import { loadMigrations, migrate } from "../src/migrate.ts";
import { owner } from "./helpers.ts";

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
});
