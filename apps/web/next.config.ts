import path from "node:path";
import type { NextConfig } from "next";

// Monorepo: let Next (bundler and output file tracing) see the whole repo, so hoisted
// workspace dependencies resolve and are included in the server bundle (needed on Amplify).
const repoRoot = path.join(import.meta.dirname, "../..");

const config: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
};

export default config;
