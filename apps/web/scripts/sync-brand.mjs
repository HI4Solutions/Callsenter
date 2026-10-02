// Copies the logo and icons from public/brand/ in the repo root (the source) to
// apps/web/public/brand/, which Next serves. The target folder is gitignored.
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = path.join(import.meta.dirname, "../../..");
const from = path.join(root, "public/brand");
const to = path.join(import.meta.dirname, "../public/brand");

await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });
await cp(from, to, { recursive: true, filter: (src) => !src.endsWith(".md") });
console.log(`brand: copied ${path.relative(root, from)} -> ${path.relative(root, to)}`);
