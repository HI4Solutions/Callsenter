// The call centre's daily work: sales, customers and products (apps/api/src/org/sales.ts,
// customers.ts and products.ts). Shared types and formatting for /salg, /kunder and /produkter.
import type { SaleStatus } from "@veriqall/shared";

export interface Customer {
  id: string;
  kind: "person" | "business";
  name: string;
  birthDate: string | null;
  orgNumber: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface ProductSummary {
  id: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  createdAt: string;
  publishedVersion: number | null;
  publishedVersionId: string | null;
  priceOnce: string | null;
  priceMonthly: string | null;
  bindingMonths: number | null;
  publishedAt: string | null;
  draftVersion: number | null;
}

export interface RequiredPoint {
  id: string;
  text: string;
}

export interface TemplateVersion {
  id: string;
  version: number;
  status: "draft" | "published" | "retired";
  currency: "NOK";
  priceOnce: string | null;
  priceMonthly: string | null;
  bindingMonths: number;
  noticeMonths: number;
  withdrawalDays: number;
  terms: string;
  requiredPoints: RequiredPoint[];
  approvedPhrases: string[];
  forbiddenPhrases: string[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  publishedByName: string | null;
}

export interface ProductDetail {
  id: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  createdAt: string;
  versions: TemplateVersion[];
}

export const CUSTOMER_KIND = { person: "Privatperson", business: "Bedrift" } as const;

export const VERSION_STATUS = { draft: "Utkast", published: "Gjeldende", retired: "Erstattet" } as const;

// "399.50" from the API as "399,50 kr"; whole kroner without decimals.
export function formatKroner(value: string | null): string {
  if (value === null) return "–";
  const n = Number(value);
  return `${new Intl.NumberFormat("nb-NO", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n)} kr`;
}

// The price line for a version: "399 kr/mnd + 499 kr", or "–" without a price.
export function formatPrice(v: { priceOnce: string | null; priceMonthly: string | null }): string {
  const parts = [];
  if (v.priceMonthly !== null) parts.push(`${formatKroner(v.priceMonthly)}/mnd`);
  if (v.priceOnce !== null) parts.push(v.priceMonthly !== null ? `${formatKroner(v.priceOnce)} engangs` : formatKroner(v.priceOnce));
  return parts.length ? parts.join(" + ") : "–";
}

export function months(n: number): string {
  if (n === 0) return "Ingen";
  return `${n} ${n === 1 ? "måned" : "måneder"}`;
}

export function days(n: number): string {
  if (n === 0) return "Ingen";
  return `${n} ${n === 1 ? "dag" : "dager"}`;
}

// Prices as typed in the form: "399.50" becomes "399,50".
export function priceInput(value: string | null): string {
  return value === null ? "" : value.replace(/\.00$/, "").replace(".", ",");
}

// 123456789 as "123 456 789", +4791234567 as "912 34 567".
export function formatOrgNumber(value: string | null): string {
  return value ? value.replace(/^(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3") : "–";
}

export function formatPhone(value: string | null): string {
  if (!value) return "–";
  const m = /^\+47(\d{3})(\d{2})(\d{3})$/.exec(value);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : value;
}

// One line per entry in a textarea; empty lines dropped.
export function lines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export interface SaleSummary {
  id: string;
  status: SaleStatus;
  soldAt: string;
  statusChangedAt: string;
  priceOnce: string | null;
  priceMonthly: string | null;
  bindingMonths: number;
  customerId: string;
  customerName: string | null;
  productId: string;
  productName: string;
  templateVersion: number;
  sellerId: string;
  sellerName: string | null;
  teamName: string | null;
}

export interface SaleDetail extends SaleSummary {
  note: string | null;
  withdrawalDays: number;
  templateVersionId: string;
  customerKind: Customer["kind"] | null;
  customerPhone: string | null;
  customerEmail: string | null;
  events: {
    id: string;
    fromStatus: SaleStatus | null;
    toStatus: SaleStatus;
    note: string | null;
    actorName: string | null;
    createdAt: string;
  }[];
  confirmations: Confirmation[];
}

export interface Confirmation {
  id: string;
  status: "pending" | "accepted" | "rejected" | "revoked";
  createdAt: string;
  expiresAt: string;
  viewedAt: string | null;
  decidedAt: string | null;
  method: "bankid" | "vipps" | "none" | null;
  identityName: string | null;
  identityPhone: string | null;
  identityMatch: "phone" | "name" | "none" | null;
  ip: string | null;
  documentHash: string;
  createdByName: string | null;
}

// The offer document the customer sees and accepts (apps/api/src/org/confirmations.ts).
export interface OfferDocument {
  issuedAt: string;
  seller: { company: string; orgNumber: string | null; salesperson: string | null };
  customer: { kind: Customer["kind"]; name: string; orgNumber: string | null; birthDate: string | null; phone: string | null; email: string | null; address: string | null };
  product: { name: string; templateVersion: number };
  price: { currency: "NOK"; once: string | null; monthly: string | null };
  bindingMonths: number;
  noticeMonths: number;
  withdrawalDays: number;
  terms: string;
  soldAt: string;
}

// Sales are seen with any of the call permissions (own, team, all) and made with sales.manage.
export function canSeeSales(permissions: string[]): boolean {
  return ["calls.read.own", "calls.read.team", "calls.read.all", "sales.manage"].some((p) => permissions.includes(p));
}

// Status colors are the reserved ones (CLAUDE.md, "Farger"); registered has none yet.
export function saleTone(status: SaleStatus): "ok" | "warning" | "danger" | null {
  if (status === "confirmed" || status === "active") return "ok";
  if (status === "awaiting_confirmation") return "warning";
  if (status === "registered") return null;
  return "danger";
}

// The words on the button that moves a sale to a status.
export const SALE_ACTIONS: Record<SaleStatus, string> = {
  registered: "Registrert",
  awaiting_confirmation: "Sendt til bekreftelse",
  confirmed: "Marker som bekreftet",
  active: "Marker som aktiv",
  rejected: "Kunden avviste",
  withdrawn: "Kunden angret",
  cancelled: "Kanseller",
};
