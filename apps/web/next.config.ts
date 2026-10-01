import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Monorepo: la Next se hele repoet, slik at workspace-pakker løses riktig.
  turbopack: { root: path.join(import.meta.dirname, "../..") },
};

export default config;
