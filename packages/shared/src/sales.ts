// The status flow of a sale (docs/plan.md, section 12). The database mirrors the transitions in
// `sale_status_transitions`, and a test in packages/db checks that the two never drift apart.

export const SALE_STATUSES = {
  registered: "Registrert",
  awaiting_confirmation: "Venter på bekreftelse",
  confirmed: "Bekreftet",
  active: "Aktiv",
  rejected: "Avvist",
  withdrawn: "Angret",
  cancelled: "Kansellert",
} as const;

export type SaleStatus = keyof typeof SALE_STATUSES;

export const SALE_STATUS_KEYS = Object.keys(SALE_STATUSES) as SaleStatus[];

export function isSaleStatus(value: unknown): value is SaleStatus {
  return typeof value === "string" && Object.hasOwn(SALE_STATUSES, value);
}

// The standard run is registered → awaiting confirmation → confirmed → active. The customer can
// reject the confirmation or withdraw (angrerett) after confirming; the call centre can cancel
// until then. Rejected, withdrawn and cancelled are final.
export const SALE_TRANSITIONS: Record<SaleStatus, readonly SaleStatus[]> = {
  registered: ["awaiting_confirmation", "confirmed", "cancelled"],
  awaiting_confirmation: ["confirmed", "rejected", "cancelled"],
  confirmed: ["active", "withdrawn", "cancelled"],
  active: ["withdrawn", "cancelled"],
  rejected: [],
  withdrawn: [],
  cancelled: [],
};

export function canMoveSale(from: SaleStatus, to: SaleStatus): boolean {
  return SALE_TRANSITIONS[from].includes(to);
}
