import { describe, expect, it } from "vitest";
import { seedTestData, TEST_NOTE_TEMPLATE, TEST_PRODUCT } from "../src/test-data.ts";
import { api, as, createOrg, member, owner } from "./helpers.ts";

async function seed(...orgs: string[]) {
  const client = await owner.connect();
  try {
    return await seedTestData(client, orgs);
  } finally {
    client.release();
  }
}

describe("test data for staging", () => {
  it("gives a call centre a product with a published template and a default note template, once", async () => {
    const org = await createOrg();
    expect(await seed(org)).toEqual({ organizations: 1, products: 1, noteTemplates: 1 });

    const { rows: versions } = await owner.query(
      `select v.version, v.status, v.published_at is not null as published, v.price_monthly::text, v.binding_months,
              v.withdrawal_days, v.required_points, v.forbidden_phrases
       from product_template_versions v join products p on p.id = v.product_id
       where p.organization_id = $1 and p.name = $2`,
      [org, TEST_PRODUCT.name],
    );
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      version: 1,
      status: "published",
      published: true,
      price_monthly: "49.00",
      binding_months: 12,
      withdrawal_days: 14,
      forbidden_phrases: [...TEST_PRODUCT.forbiddenPhrases],
    });
    // Each point has an id like the API's, so the AI control can mark it.
    const points = versions[0].required_points as { id: string; text: string }[];
    expect(points.map((p) => p.text)).toEqual([...TEST_PRODUCT.requiredPoints]);
    expect(points.every((p) => /^[a-f0-9]{12}$/.test(p.id))).toBe(true);
    expect(new Set(points.map((p) => p.id)).size).toBe(points.length);

    const notes = await owner.query("select name, is_default from report_templates where organization_id = $1", [org]);
    expect(notes.rows).toEqual([{ name: TEST_NOTE_TEMPLATE.name, is_default: true }]);

    // Running it again adds nothing.
    expect(await seed(org)).toEqual({ organizations: 1, products: 0, noteTemplates: 0 });
    const counts = await owner.query(
      `select (select count(*) from products where organization_id = $1)::int as products,
              (select count(*) from report_templates where organization_id = $1)::int as notes`,
      [org],
    );
    expect(counts.rows[0]).toEqual({ products: 1, notes: 1 });
  });

  it("keeps the call centre's own default note template, and leaves archived test data archived", async () => {
    const org = await createOrg();
    await owner.query(
      "insert into report_templates (organization_id, name, instructions, is_default) values ($1, 'Vårt notat', 'Skriv kort.', true)",
      [org],
    );
    await owner.query("insert into products (organization_id, name, archived_at) values ($1, $2, now())", [
      org,
      TEST_PRODUCT.name.toUpperCase(),
    ]);
    expect(await seed(org)).toEqual({ organizations: 1, products: 0, noteTemplates: 1 });
    const notes = await owner.query(
      "select name, is_default from report_templates where organization_id = $1 order by name",
      [org],
    );
    expect(notes.rows).toEqual([
      { name: TEST_NOTE_TEMPLATE.name, is_default: false },
      { name: "Vårt notat", is_default: true },
    ]);
  });

  it("is seen by the call centre's own members only", async () => {
    const [org, other] = [await createOrg(), await createOrg()];
    await seed(org);
    const seller = await member(org, "seller");
    const outsider = await member(other, "seller");
    const products = (ctx: { userId: string; orgId: string }) =>
      as(api, ctx, async (db) => (await db.query("select name from products where name = $1", [TEST_PRODUCT.name])).rows);
    expect(await products({ userId: seller, orgId: org })).toEqual([{ name: TEST_PRODUCT.name }]);
    expect(await products({ userId: outsider, orgId: other })).toEqual([]);
  });
});
