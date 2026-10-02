// Bundles the Lambda handlers into dist/ (one .mjs per handler) together with the migration
// files. The deploy workflow zips dist/ and uploads it as the Lambda artifact.
import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const root = path.join(import.meta.dirname, "..");
const dist = path.join(root, "dist");

await rm(dist, { recursive: true, force: true });
await build({
  entryPoints: {
    api: path.join(root, "src/api.ts"),
    migrator: path.join(root, "src/migrator.ts"),
    worker: path.join(root, "src/worker.ts"),
  },
  outdir: dist,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // pg tries to load the optional native driver; we use the pure JS one.
  external: ["pg-native"],
  // Some bundled CommonJS dependencies call require() for Node built-ins.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  legalComments: "none",
  logLevel: "warning",
});
await cp(path.join(root, "../../packages/db/migrations"), path.join(dist, "migrations"), { recursive: true });
console.log(`built ${path.relative(process.cwd(), dist)}`);
