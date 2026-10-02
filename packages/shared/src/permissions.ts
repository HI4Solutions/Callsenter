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

// Permissions whose session must have been started with BankID (proposal in docs/auth.md;
// enforced from PR 3).
export const STRONG_AUTH_PERMISSIONS: readonly Permission[] = [
  "audit.read",
  "users.manage",
  "roles.manage",
  "calls.read.all",
];
