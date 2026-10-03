import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// The pages' texts in every language (src/i18n/request.ts, docs/plan.md, section 19).
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Monorepo: let Next (bundler and output file tracing) see the whole repo, so hoisted
// workspace dependencies resolve and are included in the server bundle (needed on Amplify).
const repoRoot = path.join(import.meta.dirname, "../..");

// Once the landing page is published (src/lib/site.ts), the front page may be indexed; every
// other page is still behind login.
const landingPublished = process.env.NEXT_PUBLIC_LANDING_PUBLISHED === "1";

const config: NextConfig = {
  reactStrictMode: true,
  // Pages ending in .dev.tsx (the design system at /design) exist only in development.
  pageExtensions: process.env.NODE_ENV === "production" ? ["tsx", "ts"] : ["dev.tsx", "tsx", "ts"],
  // Do not advertise the framework in a response header.
  poweredByHeader: false,
  async headers() {
    return [
      {
        // The app is behind login and nothing in it is for search engines. A header rather than
        // robots.txt: crawlers must be allowed to fetch a page to see that it is not to be indexed.
        source: landingPublished ? "/:path+" : "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/:path*",
        headers: [
          // No other site may show the app in a frame (clickjacking on login, admin and the
          // customer's acceptance page).
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          // The link a customer gets (/bekreft/<token>) must not travel on to other sites.
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // The recorder uses the microphone and, for tab audio, screen sharing; nothing else.
          { key: "Permissions-Policy", value: "microphone=(self), display-capture=(self), camera=(), geolocation=(), payment=(), usb=()" },
        ],
      },
    ];
  },
  // next dev would otherwise write AGENTS.md and CLAUDE.md into apps/web on every start.
  agentRules: false,
  // Workspace package shipped as TypeScript source (permission and module catalogs).
  transpilePackages: ["@veriqall/shared"],
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
};

export default withNextIntl(config);
