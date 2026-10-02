// Invoicing (apps/api/src/admin/billing.ts): MedInnova invoices the call centres.

export type InvoiceStatus = "draft" | "sent" | "paid" | "credited";

export interface InvoiceSummary {
  id: string;
  organizationId: string;
  organizationName: string;
  kind: "invoice" | "credit";
  creditOf: string | null;
  status: InvoiceStatus;
  number: number | null;
  issueDate: string | null;
  dueDate: string | null;
  note: string | null;
  sentAt: string | null;
  paidAt: string | null;
  createdAt: string;
  recurringId: string | null;
  overdue: boolean;
  subtotal: string;
  vat: string;
  total: string;
  paid: string;
}

export interface InvoiceLine {
  id: string;
  position: number;
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: number;
  amount: string;
}

export interface Party {
  name: string | null;
  orgNumber: string | null;
  address: string | null;
  email: string | null;
  accountNumber?: string | null;
  vatRegistered?: boolean;
  footer?: string | null;
  contactName?: string | null;
}

export interface InvoiceDetail extends InvoiceSummary {
  seller: Party | null;
  recipient: Party | null;
  organizationOrgNumber: string | null;
  organizationInvoiceEmail: string | null;
  organizationInvoiceAddress: string | null;
  creditOfNumber: number | null;
  creditNote: { id: string; number: number } | null;
  lines: InvoiceLine[];
  payments: { id: string; amount: string; paidOn: string; method: "bank" | "stripe" | "other"; reference: string | null; createdAt: string }[];
  // Superadmins only: when and to whom it was e-mailed.
  emails: { sentTo: string; sentAt: string }[];
}

export interface BillingSettings {
  companyName: string | null;
  orgNumber: string | null;
  vatRegistered: boolean;
  address: string | null;
  email: string | null;
  accountNumber: string | null;
  dueDays: number;
  nextNumber: number;
  footer: string | null;
  priceAudioHour: string | null;
  priceAiControl: string | null;
  updatedAt: string;
}

export interface RecurringInvoice {
  id: string;
  organizationId: string;
  organizationName: string;
  name: string;
  lines: { description: string; quantity: number; unitPrice: number; vatRate: number }[];
  intervalMonths: 1 | 3 | 6 | 12;
  nextDate: string;
  active: boolean;
  updatedAt: string;
}

export interface BillingOverview {
  mrr: string;
  invoicedMonth: string;
  invoicedYear: string;
  outstanding: string;
  overdue: string;
  drafts: number;
  recurringDue: number;
}

export const INVOICE_STATUS: Record<InvoiceStatus, string> = { draft: "Utkast", sent: "Sendt", paid: "Betalt", credited: "Kreditert" };
export const PAYMENT_METHOD = { bank: "Bank", stripe: "Stripe", other: "Annet" } as const;
export const INTERVAL: Record<RecurringInvoice["intervalMonths"], string> = { 1: "Hver måned", 3: "Hvert kvartal", 6: "Hvert halvår", 12: "Hvert år" };
export const VAT_RATES = [0.25, 0.15, 0.12, 0] as const;

const nok = new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function kr(value: string | number | null): string {
  return value === null ? "–" : `${nok.format(Number(value))} kr`;
}

export function percent(rate: number): string {
  return `${Math.round(rate * 100)} %`;
}

// 12345678903 as "1234 56 78903".
export function formatAccount(value: string | null | undefined): string {
  return value && /^\d{11}$/.test(value) ? `${value.slice(0, 4)} ${value.slice(4, 6)} ${value.slice(6)}` : (value ?? "");
}

export function invoiceTitle(i: Pick<InvoiceSummary, "kind" | "number">): string {
  const kind = i.kind === "credit" ? "Kreditnota" : "Faktura";
  return i.number === null ? `${kind} (utkast)` : `${kind} ${i.number}`;
}
