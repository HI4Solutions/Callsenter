import type { MetadataRoute } from "next";
import { LANDING_PUBLISHED, PRIVATE_PATHS, SITE_URL } from "@/lib/site";

// Search engines: nothing until the landing page is published, then only the front page. The
// X-Robots-Tag header (next.config.ts) says the same for every page behind login.
export default function robots(): MetadataRoute.Robots {
  if (!LANDING_PUBLISHED) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS.map((p) => `${p}/`).concat(PRIVATE_PATHS) },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
