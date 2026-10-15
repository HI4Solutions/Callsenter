// Migrator Lambda: runs pending migrations and provisions the database logins, as the RDS
// master user (the schema owner). Invoked by the deploy workflow after each deploy; it is the
// only way migrations reach the cloud databases (CLAUDE.md, "Databaseendringer").
//
// Invoked by hand with {"action": "invite-platform-admin", "fullName": "...", "phone": "+47...",
// "email": "..."} it creates a superadmin invitation and returns the link (see infra/README.md).
// With {"action": "seed-test-data"}, run by the staging deploy, it gives every call centre in
// staging a fictitious product and note template to test with; it refuses in any other
// environment.
import path from "node:path";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { invitePlatformAdmin, loadMigrations, migrate, provision, seedTestData } from "@veriqall/db";
import pg from "pg";
import { required } from "./env.ts";

const secrets = new SecretsManagerClient({});

export interface MigratorEvent {
  action?: "migrate" | "invite-platform-admin" | "seed-test-data";
  fullName?: string;
  phone?: string;
  email?: string;
}

export async function handler(event?: MigratorEvent | null) {
  // Test data belongs in staging, never in production.
  if (event?.action === "seed-test-data" && process.env.ENVIRONMENT !== "staging") {
    throw new Error("seed-test-data runs only in staging");
  }
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
    if (event?.action === "invite-platform-admin") {
      const invitation = await invitePlatformAdmin(client, {
        fullName: event.fullName ?? "",
        phone: event.phone,
        email: event.email,
      });
      // The link goes only to whoever invoked the function, never to the log.
      console.log(JSON.stringify({ action: event.action, userId: invitation.userId }));
      const link = new URL("/logg-inn", required("APP_ORIGIN"));
      link.searchParams.set("invitasjon", invitation.token);
      return { userId: invitation.userId, link: link.toString(), expiresAt: invitation.expiresAt };
    }
    if (event?.action === "seed-test-data") {
      const { rows } = await client.query<{ id: string }>("select id from organizations order by created_at");
      const seeded = await seedTestData(client, rows.map((r) => r.id));
      console.log(JSON.stringify({ action: event.action, ...seeded }));
      return seeded;
    }
    const applied = await migrate(client, await loadMigrations(path.join(import.meta.dirname, "migrations")));
    const provisioned = await provision(client);
    const result = { applied, provisioned };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    await client.end();
  }
}
