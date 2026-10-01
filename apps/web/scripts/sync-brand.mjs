// Kopierer logo og ikoner fra public/brand/ i reporoten (kilden) til
// apps/web/public/brand/, som Next serverer. Målmappen er gitignorert.
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = path.join(import.meta.dirname, "../../..");
const from = path.join(root, "public/brand");
const to = path.join(import.meta.dirname, "../public/brand");

await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });
await cp(from, to, { recursive: true });
console.log(`brand: kopierte ${path.relative(root, from)} -> ${path.relative(root, to)}`);
