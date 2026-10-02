import path from "node:path";
import type { NextConfig } from "next";

// Monorepo: let Next (bundler and output file tracing) see the whole repo, so hoisted
// workspace dependencies resolve and are included in the server bundle (needed on Amplify).
const repoRoot = path.join(import.meta.dirname, "../..");

const config: NextConfig = {
  reactStrictMode: true,
  // Pages ending in .dev.tsx (the design system at /design) exist only in development.
  pageExtensions: process.env.NODE_ENV === "production" ? ["tsx", "ts"] : ["dev.tsx", "tsx", "ts"],
  // Do not advertise the framework in a response header.
  poweredByHeader: false,
  // The app is behind login and nothing in it is for search engines. A header rather than
  // robots.txt: crawlers must be allowed to fetch a page to see that it is not to be indexed.
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
  },
  // next dev would otherwise write AGENTS.md and CLAUDE.md into apps/web on every start.
  agentRules: false,
  // Workspace package shipped as TypeScript source (permission and module catalogs).
  transpilePackages: ["@veriqall/shared"],
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
};

export default config;
