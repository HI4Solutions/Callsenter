import type { MetadataRoute } from "next";

// Behind login: no crawling at all.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
