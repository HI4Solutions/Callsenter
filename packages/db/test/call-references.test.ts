import { describe, expect, it } from "vitest";
import { api, as, createOrg, member, owner, rejects } from "./helpers.ts";

const newCall = (org: string, user: string, reference?: string) =>
  as(api, { userId: user, orgId: org }, async (db) => {
    const { rows } = await db.query(
      `insert into calls (organization_id, user_id, source, transcription_mode, reference)
       values ($1, $2, 'microphone', 'chunked', coalesce($3, 'VQ-AAAA-AAAA')) returning id, reference`,
      [org, user, reference ?? null],
    );
    await db.query("commit");
    return rows[0] as { id: string; reference: string };
  });

describe("call references", () => {
  it("gives every call its own readable reference, set by the database", async () => {
    const org = await createOrg();
    const seller = await member(org, "seller");
    const a = await newCall(org, seller, "VQ-FAKE-0000");
    const b = await newCall(org, seller);
    expect(a.reference).toMatch(/^VQ-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(a.reference).not.toBe("VQ-FAKE-0000");
    expect(b.reference).not.toBe(a.reference);
  });

  it("never changes, and is found only within the call centre", async () => {
    const org = await createOrg();
    const other = await createOrg();
    const seller = await member(org, "seller");
    const admin = await member(org, "admin");
    const outsider = await member(other, "admin");
    const call = await newCall(org, seller);
    await expect(owner.query("update calls set reference = 'VQ-AAAA-BBBB' where id = $1", [call.id])).rejects.toThrow(/keeps its reference/);
    await as(api, { userId: admin, orgId: org }, async (db) => {
      expect((await db.query("select id from calls where reference = $1", [call.reference])).rows).toEqual([{ id: call.id }]);
      await rejects(db, "update calls set reference = 'VQ-AAAA-BBBB' where id = $1", [call.id], /permission denied|keeps its reference/);
    });
    await as(api, { userId: outsider, orgId: other }, async (db) => {
      expect((await db.query("select id from calls where reference = $1", [call.reference])).rows).toEqual([]);
    });
  });
});
