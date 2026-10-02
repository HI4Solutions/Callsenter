import { describe, expect, it } from "vitest";
import { api, as, createOrg, member, owner } from "./helpers.ts";

async function product(orgId: string, name = `Strøm ${Math.random().toString(36).slice(2, 7)}`) {
  const { rows } = await owner.query<{ id: string }>("insert into products (organization_id, name) values ($1, $2) returning id", [
    orgId,
    name,
  ]);
  return rows[0]!.id;
}

async function version(orgId: string, productId: string, n: number, status = "draft") {
  const { rows } = await owner.query<{ id: string }>(
    `insert into product_template_versions (organization_id, product_id, version, status, published_at, price_monthly)
     values ($1, $2, $3, $4, case when $4 = 'draft' then null else now() end, 399) returning id`,
    [orgId, productId, n, status],
  );
  return rows[0]!.id;
}

describe("customers", () => {
  it("are read with customers.read and written with customers.manage, per call centre", async () => {
    const org = await createOrg();
    const other = await createOrg();
    const seller = await member(org, "seller");
    const compliance = await member(org, "compliance");
    const outsider = await member(other, "admin");
    const insert = "insert into customers (organization_id, kind, name, phone) values ($1, 'person', 'Kari Kunde', '+4791234567') returning id";

    const id = await as(api, { userId: seller, orgId: org }, async (db) => (await db.query(insert, [org])).rows[0].id);
    await owner.query(insert.replace("returning id", ""), [org]); // committed copy for the reads below

    await as(api, { userId: compliance, orgId: org }, async (db) => {
      expect((await db.query("select count(*)::int as n from customers")).rows[0].n).toBeGreaterThan(0);
      await expect(db.query(insert, [org])).rejects.toThrow(/row-level security/);
    });
    await as(api, { userId: outsider, orgId: other }, async (db) => {
      expect((await db.query("select * from customers where organization_id = $1", [org])).rows).toEqual([]);
    });
    expect(id).toBeTruthy();
  });

  it("keep person and business fields apart", async () => {
    const org = await createOrg();
    await expect(
      owner.query("insert into customers (organization_id, kind, name, org_number) values ($1, 'person', 'X', '123456789')", [org]),
    ).rejects.toThrow(/check/);
    await expect(
      owner.query("insert into customers (organization_id, kind, name, birth_date) values ($1, 'business', 'X AS', '1980-01-01')", [org]),
    ).rejects.toThrow(/check/);
    await owner.query("insert into customers (organization_id, kind, name, org_number) values ($1, 'business', 'X AS', '987654321')", [org]);
    await expect(
      owner.query("insert into customers (organization_id, kind, name, org_number) values ($1, 'business', 'Y AS', '987654321')", [org]),
    ).rejects.toThrow(/customers_org_number_key/);
  });
});

describe("products and template versions", () => {
  it("are visible to every member, and changed only with products.manage", async () => {
    const org = await createOrg();
    const productId = await product(org);
    const seller = await member(org, "seller");
    const admin = await member(org, "admin");
    await as(api, { userId: seller, orgId: org }, async (db) => {
      expect((await db.query("select id from products where id = $1", [productId])).rows).toHaveLength(1);
      await expect(db.query("insert into products (organization_id, name) values ($1, 'Ny')", [org])).rejects.toThrow(
        /row-level security/,
      );
    });
    await as(api, { userId: admin, orgId: org }, async (db) => {
      await db.query("insert into products (organization_id, name) values ($1, 'Ny')", [org]);
      await db.query(
        "insert into product_template_versions (organization_id, product_id, version) values ($1, $2, 1)",
        [org, productId],
      );
    });
  });

  it("freeze a version once published, and allow only retiring it", async () => {
    const org = await createOrg();
    const productId = await product(org);
    const v1 = await version(org, productId, 1);
    await owner.query("update product_template_versions set price_monthly = 449 where id = $1", [v1]);
    await owner.query("update product_template_versions set status = 'published', published_at = now() where id = $1", [v1]);
    await expect(owner.query("update product_template_versions set price_monthly = 1 where id = $1", [v1])).rejects.toThrow(
      /cannot be changed/,
    );
    await expect(owner.query("delete from product_template_versions where id = $1", [v1])).rejects.toThrow(/cannot be deleted/);
    await expect(
      owner.query("update product_template_versions set status = 'retired', price_monthly = 1 where id = $1", [v1]),
    ).rejects.toThrow(/cannot be changed/);
    await owner.query("update product_template_versions set status = 'retired' where id = $1", [v1]);
    await expect(owner.query("update product_template_versions set status = 'published' where id = $1", [v1])).rejects.toThrow(
      /cannot be changed/,
    );
  });

  it("have at most one draft and one published version per product", async () => {
    const org = await createOrg();
    const productId = await product(org);
    await version(org, productId, 1, "published");
    await expect(version(org, productId, 2, "published")).rejects.toThrow(/product_template_versions_published/);
    await version(org, productId, 2);
    await expect(version(org, productId, 3)).rejects.toThrow(/product_template_versions_draft/);
  });
});
