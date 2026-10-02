import { describe, expect, it } from "vitest";
import { LOGINS, provision } from "../src/provision.ts";
import { owner } from "./helpers.ts";

async function memberOf(login: string) {
  const { rows } = await owner.query<{ rolname: string }>(
    `select g.rolname from pg_auth_members m
     join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
     where u.rolname = $1 order by g.rolname`,
    [login],
  );
  return rows.map((r) => r.rolname);
}

describe("provision", () => {
  it("creates the Lambda logins in the right group roles, and is idempotent", async () => {
    const client = await owner.connect();
    try {
      const first = await provision(client);
      await provision(client);
      expect(first.logins).toEqual(Object.keys(LOGINS));
      // rds_iam and pgaudit exist only on RDS.
      expect(first.iamAuthentication).toBe(false);
      expect(await memberOf("veriqall_api")).toEqual(["app_user"]);
      expect(await memberOf("veriqall_auth")).toEqual(["app_auth"]);
      expect(await memberOf("veriqall_worker")).toEqual(["app_worker"]);
    } finally {
      client.release();
    }
  });
});
