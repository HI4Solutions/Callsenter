import type { ClientBase } from "pg";

// Login users the Lambdas connect as. They have no password: on RDS they sign in with IAM
// authentication tokens (role rds_iam), so no database password exists outside AWS.
export const LOGINS = {
  veriqall_api: "app_user",
  veriqall_auth: "app_auth",
} as const;

export interface ProvisionResult {
  logins: string[];
  iamAuthentication: boolean;
  pgaudit: boolean;
}

// Runs after the migrations, as the owner. Idempotent. Environment setup that is not a schema
// change, and that depends on RDS (rds_iam, pgaudit), so it is not part of a migration file.
export async function provision(client: ClientBase): Promise<ProvisionResult> {
  const { rows } = await client.query<{ iam: boolean; pgaudit: boolean }>(`
    select
      exists (select 1 from pg_roles where rolname = 'rds_iam') as iam,
      exists (select 1 from pg_available_extensions where name = 'pgaudit') as pgaudit`);
  const { iam, pgaudit } = rows[0]!;

  for (const [login, group] of Object.entries(LOGINS)) {
    const exists = await client.query("select 1 from pg_roles where rolname = $1", [login]);
    if (!exists.rowCount) {
      await client.query(`create role ${login} login`);
    }
    await client.query(`grant ${group} to ${login}`);
    if (iam) {
      await client.query(`grant rds_iam to ${login}`);
    }
  }
  if (pgaudit) {
    await client.query("create extension if not exists pgaudit");
  }
  return { logins: Object.keys(LOGINS), iamAuthentication: iam, pgaudit };
}
