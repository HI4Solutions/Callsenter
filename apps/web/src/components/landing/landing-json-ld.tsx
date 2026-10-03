import { LOCALE_CODES } from "@veriqall/shared";
import { SITE_URL } from "@/lib/site";

// Structured data for search engines (schema.org): who publishes the site, the site itself, and
// VeriQall as a product. No prices: they are given on request.
export function LandingJsonLd({ description }: { description: string }) {
  const organization = `${SITE_URL}/#organization`;
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": organization, name: "Hi4 Solutions AS", url: SITE_URL, logo: `${SITE_URL}/brand/icon-512.png` },
      { "@type": "WebSite", "@id": `${SITE_URL}/#website`, url: SITE_URL, name: "VeriQall", publisher: { "@id": organization }, inLanguage: LOCALE_CODES },
      {
        "@type": "SoftwareApplication",
        name: "VeriQall",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description,
        url: SITE_URL,
        provider: { "@id": organization },
      },
    ],
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}
