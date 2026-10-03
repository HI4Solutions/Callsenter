// The permission catalog (docs/plan.md, section 4). Permissions are code; roles are data per
// call centre. The database mirrors this list in the `permissions` table, and a test in
// packages/db checks that the two never drift apart.

export const PERMISSIONS = {
  "calls.read.own": "Egne samtaler",
  "calls.read.team": "Teamets samtaler",
  "calls.read.all": "Alle samtaler i callsenteret",
  "calls.audio.play": "Avspilling av opptak",
  "calls.upload": "Laste opp opptak",
  "customers.read": "Se kunder og historikk",
  "customers.manage": "Opprette og endre kunder",
  "sales.manage": "Registrere og endre salg",
  "flags.review": "Behandle gule og røde flagg",
  "complaints.manage": "Klagesaker",
  "coaching.give": "Tilbakemeldinger til selgere",
  "dashboard.team": "Dashboard for teamet",
  "dashboard.all": "Dashboard for hele callsenteret",
  "products.manage": "Produkter og produktmaler",
  "report_templates.manage": "Rapportmaler",
  "users.manage": "Brukere og team",
  "roles.manage": "Roller og rettigheter",
  "audit.read": "Revisjons- og tilgangslogg",
  "billing.read": "Fakturaer",
} as const;

export type Permission = keyof typeof PERMISSIONS;

// The permissions by area, for showing and choosing them on the roles page. Every permission is
// in exactly one group (tested).
export const PERMISSION_GROUPS: readonly { key: "calls" | "sales" | "quality" | "administration"; name: string; permissions: readonly Permission[] }[] = [
  { key: "calls", name: "Samtaler", permissions: ["calls.read.own", "calls.read.team", "calls.read.all", "calls.audio.play", "calls.upload", "report_templates.manage"] },
  { key: "sales", name: "Salg og kunder", permissions: ["customers.read", "customers.manage", "sales.manage", "products.manage"] },
  { key: "quality", name: "Kvalitet og coaching", permissions: ["flags.review", "complaints.manage", "coaching.give", "dashboard.team", "dashboard.all"] },
  { key: "administration", name: "Administrasjon", permissions: ["users.manage", "roles.manage", "audit.read", "billing.read"] },
];

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && Object.hasOwn(PERMISSIONS, value);
}

// Default roles seeded for every new call centre. Admins can create more roles,
// but only with permissions they hold themselves.
export const DEFAULT_ROLES = {
  seller: {
    name: "Selger",
    permissions: [
      "calls.read.own",
      "calls.audio.play",
      "calls.upload",
      "customers.read",
      "customers.manage",
      "sales.manage",
    ],
  },
  leader: {
    name: "Leder",
    permissions: [
      "calls.read.own",
      "calls.read.team",
      "calls.audio.play",
      "calls.upload",
      "customers.read",
      "customers.manage",
      "sales.manage",
      "flags.review",
      "coaching.give",
      "dashboard.team",
    ],
  },
  compliance: {
    name: "Compliance",
    permissions: [
      "calls.read.all",
      "calls.audio.play",
      "customers.read",
      "flags.review",
      "complaints.manage",
      "dashboard.all",
      "audit.read",
    ],
  },
  admin: {
    name: "Admin",
    permissions: PERMISSION_KEYS,
  },
} as const satisfies Record<string, { name: string; permissions: readonly Permission[] }>;

export type DefaultRoleKey = keyof typeof DEFAULT_ROLES;

// Permissions that need a session started with BankID (decided 2 October 2026, see
// docs/auth.md). A session started with Vipps simply does not hold them; enforced from PR 3.
export const STRONG_AUTH_PERMISSIONS: readonly Permission[] = [
  "audit.read",
  "users.manage",
  "roles.manage",
  "calls.read.all",
  "billing.read",
];

// Session lifetime (decided 2 October 2026).
export const SESSION_IDLE_TIMEOUT_MINUTES = 60;
export const SESSION_MAX_HOURS = 14;
