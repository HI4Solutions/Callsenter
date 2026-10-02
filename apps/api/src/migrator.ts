// Migrator Lambda: runs pending migrations and provisions the database logins, as the RDS
// master user (the schema owner). Invoked by the deploy workflow after each deploy; it is the
// only way migrations reach the cloud databases (CLAUDE.md, "Databaseendringer").
import path from "node:path";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { loadMigrations, migrate, provision } from "@veriqall/db";
import pg from "pg";
import { required } from "./env.ts";

const secrets = new SecretsManagerClient({});

export async function handler() {
  const { SecretString } = await secrets.send(
    new GetSecretValueCommand({ SecretId: required("DB_MASTER_SECRET_ARN") }),
  );
  const master = JSON.parse(SecretString ?? "{}") as { username: string; password: string };

  const client = new pg.Client({
    host: required("DB_HOST"),
    port: Number(required("DB_PORT")),
    database: required("DB_NAME"),
    user: master.username,
    password: master.password,
    // RDS requires TLS (rds.force_ssl); the RDS CA comes from NODE_EXTRA_CA_CERTS.
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  try {
    const applied = await migrate(client, await loadMigrations(path.join(import.meta.dirname, "migrations")));
    const provisioned = await provision(client);
    const result = { applied, provisioned };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    await client.end();
  }
}
