import { Signer } from "@aws-sdk/rds-signer";
import pg from "pg";
import { required } from "./env.ts";

// Connection pool for one database login, authenticated with short-lived IAM tokens instead
// of a password. One pool per Lambda container, created on first use.
export function iamPool(user: string): pg.Pool {
  const host = required("DB_HOST");
  const port = Number(required("DB_PORT"));
  const signer = new Signer({ hostname: host, port, username: user });
  return new pg.Pool({
    host,
    port,
    database: required("DB_NAME"),
    user,
    password: () => signer.getAuthToken(),
    ssl: { rejectUnauthorized: true },
    max: 2,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 5_000,
  });
}
