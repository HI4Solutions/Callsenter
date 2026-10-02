// Creates a throwaway database for the test run, the way RDS will look: migrations run as a
// non-superuser owner, and the API and login Lambdas connect as login roles that are members
// of app_user and app_auth.
import pg from "pg";
import type { TestProject } from "vitest/node";
import { loadMigrations, migrate } from "../src/migrate.ts";

const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";

const OWNER = "veriqall_test_owner";
const API = "veriqall_test_api";
const AUTH = "veriqall_test_auth";
const PASSWORD = "test-only";

declare module "vitest" {
  export interface ProvidedContext {
    ownerUrl: string;
    apiUrl: string;
    authUrl: string;
  }
}

function urlFor(user: string, database: string) {
  const url = new URL(ADMIN_URL);
  url.username = user;
  url.password = PASSWORD;
  url.pathname = `/${database}`;
  return url.toString();
}

async function admin<T>(fn: (client: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export default async function setup(project: TestProject) {
  const database = `veriqall_test_${process.pid}`;

  await admin(async (client) => {
    for (const [role, extra] of [[OWNER, "createrole"], [API, ""], [AUTH, ""]] as const) {
      const exists = await client.query("select 1 from pg_roles where rolname = $1", [role]);
      const verb = exists.rowCount ? "alter" : "create";
      await client.query(`${verb} role ${role} login nosuperuser ${extra} password '${PASSWORD}'`);
    }
    await client.query(`drop database if exists ${database} with (force)`);
    await client.query(`create database ${database} owner ${OWNER}`);
  });

  const owner = new pg.Client({ connectionString: urlFor(OWNER, database) });
  await owner.connect();
  try {
    await migrate(owner, await loadMigrations());
  } finally {
    await owner.end();
  }

  // The group roles exist now; make the login roles members, as infrastructure will on RDS.
  await admin(async (client) => {
    await client.query(`grant app_user to ${API}`);
    await client.query(`grant app_auth to ${AUTH}`);
  });

  project.provide("ownerUrl", urlFor(OWNER, database));
  project.provide("apiUrl", urlFor(API, database));
  project.provide("authUrl", urlFor(AUTH, database));

  return async () => {
    await admin((client) => client.query(`drop database if exists ${database} with (force)`));
  };
}
