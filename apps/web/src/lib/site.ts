// The public web site (docs/plan.md, section 20).
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://veriqall.no").replace(/\/$/, "");

// The landing page is published at / when this is "1" (set per environment in
// infra/amplify-web.yml). Until then / sends visitors to login, search engines are kept out of
// everything, and superadmins preview the page at /forhandsvisning/landingsside.
export const LANDING_PUBLISHED = process.env.NEXT_PUBLIC_LANDING_PUBLISHED === "1";

// The app behind login: never for search engines, published or not.
export const PRIVATE_PATHS = [
  "/admin",
  "/administrasjon",
  "/bekreft",
  "/forhandsvisning",
  "/klager",
  "/konto",
  "/kunder",
  "/logg-inn",
  "/oversikt",
  "/produkter",
  "/salg",
  "/samtaler",
];
