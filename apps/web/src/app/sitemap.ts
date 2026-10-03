import type { MetadataRoute } from "next";
import { LANDING_PUBLISHED, SITE_URL } from "@/lib/site";

// Only the front page is public (docs/plan.md, section 20).
export default function sitemap(): MetadataRoute.Sitemap {
  if (!LANDING_PUBLISHED) return [];
  return [{ url: `${SITE_URL}/`, changeFrequency: "monthly", priority: 1 }];
}
