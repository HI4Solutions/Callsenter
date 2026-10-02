import { describe, expect, it } from "vitest";
import { api, as, createOrg, createUser, makePlatformAdmin, member, owner } from "./helpers.ts";

async function superadmin() {
  const id = await createUser("Melder");
  await makePlatformAdmin(id);
  return id;
}

async function announce(values: { title: string; audience?: string; active?: boolean; endsAt?: string; orgs?: string[] }) {
  const { rows } = await owner.query<{ id: string }>(
    "insert into announcements (title, body, audience, active, ends_at) values ($1, 'Tekst', $2, $3, $4) returning id",
    [values.title, values.audience ?? "all", values.active ?? true, values.endsAt ?? null],
  );
  for (const org of values.orgs ?? []) {
    await owner.query("insert into announcement_organizations (announcement_id, organization_id) values ($1, $2)", [rows[0]!.id, org]);
  }
  return rows[0]!.id;
}

describe("announcements", () => {
  it("are shown to the users they are meant for, while live", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const inA = await member(orgA, "seller");
    const inB = await member(orgB, "seller");
    const all = await announce({ title: "Til alle" });
    const onlyA = await announce({ title: "Bare A", audience: "selected", orgs: [orgA] });
    const off = await announce({ title: "Av", active: false });
    const over = await announce({ title: "Utløpt", endsAt: new Date(Date.now() + 1000).toISOString() });
    await owner.query("update announcements set starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' where id = $1", [
      over,
    ]);

    const seen = (userId: string) =>
      as(api, { userId }, async (db) => (await db.query<{ id: string }>("select id from announcements")).rows.map((r) => r.id));
    const a = await seen(inA);
    expect(a).toEqual(expect.arrayContaining([all, onlyA]));
    expect(a).not.toContain(off);
    expect(a).not.toContain(over);
    const b = await seen(inB);
    expect(b).toContain(all);
    expect(b).not.toContain(onlyA);
  });

  it("are written only by superadmins in a BankID session", async () => {
    const org = await createOrg();
    const admin = await member(org, "admin");
    await as(api, { userId: admin, orgId: org }, async (db) => {
      await expect(db.query("insert into announcements (title, body) values ('x', 'y')")).rejects.toThrow(/row-level security/);
    });
    const me = await superadmin();
    await as(api, { userId: me, strong: false }, async (db) => {
      await expect(db.query("insert into announcements (title, body) values ('x', 'y')")).rejects.toThrow(/row-level security/);
    });
    await as(api, { userId: me }, async (db) => {
      await db.query("insert into announcements (title, body, link_url) values ('x', 'y', 'https://veriqall.no')");
      await expect(db.query("insert into announcements (title, body, link_url) values ('x', 'y', 'javascript:alert(1)')")).rejects.toThrow(
        /check/,
      );
    });
  });
});

describe("growth", () => {
  it("counts per month for superadmins only", async () => {
    const me = await superadmin();
    await createOrg();
    const rows = await as(api, { userId: me }, async (db) => (await db.query("select * from app.admin_growth(3)")).rows);
    expect(rows).toHaveLength(3);
    expect(rows[2].new_organizations).toBeGreaterThanOrEqual(1);
    const org = await createOrg();
    const admin = await member(org, "admin");
    const none = await as(api, { userId: admin, orgId: org }, async (db) => (await db.query("select * from app.admin_growth(3)")).rows);
    expect(none).toEqual([]);
  });
});
