// Runs pending migrations against DATABASE_URL. In the cloud this runs inside the migrator
// Lambda in the VPC (docs/plan.md, section 3); locally against your own database.
import pg from "pg";
import { loadMigrations, migrate } from "./migrate.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const applied = await migrate(client, await loadMigrations());
  console.log(applied.length > 0 ? `applied: ${applied.join(", ")}` : "no pending migrations");
} finally {
  await client.end();
}
