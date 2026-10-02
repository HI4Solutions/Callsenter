import { DEFAULT_ROLES, PERMISSION_KEYS } from "@veriqall/shared";
import { describe, expect, it } from "vitest";
import { createOrg, owner } from "./helpers.ts";

describe("permission catalog", () => {
  it("matches the catalog in packages/shared", async () => {
    const { rows } = await owner.query<{ key: string }>("select key from permissions order by key");
    expect(rows.map((r) => r.key)).toEqual([...PERMISSION_KEYS].sort());
  });

  it("seeds the default roles from packages/shared for every new call centre", async () => {
    const orgId = await createOrg();
    const { rows } = await owner.query<{ key: string; name: string; permissions: string[] }>(
      `select r.key, r.name, array_agg(rp.permission order by rp.permission) as permissions
       from roles r join role_permissions rp on rp.role_id = r.id
       where r.organization_id = $1 and r.is_default
       group by r.key, r.name order by r.key`,
      [orgId],
    );
    const expected = Object.entries(DEFAULT_ROLES)
      .map(([key, role]) => ({ key, name: role.name, permissions: [...role.permissions].sort() }))
      .sort((a, b) => a.key.localeCompare(b.key));
    expect(rows).toEqual(expected);
  });
});
