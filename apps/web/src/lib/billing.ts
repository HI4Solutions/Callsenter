import { API_URL } from "./auth";

// Invoicing (apps/api/src/admin/billing.ts): MedInnova invoices the call centres.

export type InvoiceStatus = "draft" | "scheduled" | "sent" | "paid" | "credited" | "payment_missed";

export interface InvoiceSummary {
  id: string;
  organizationId: string;
  organizationName: string;
  customerNumber: number;
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
  missedAt: string | null;
  grantAccess: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  overdue: boolean;
  subtotal: string;
  vat: string;
  total: string;
  paid: string;
}

export interface InvoiceLine {
  id: string;
  position: number;
  kind: "package" | "text" | "fee";
  packageId: string | null;
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
  customerNumber?: number | null;
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
  invoiceFee: string | null;
  recurringDaysBefore: number;
  copyEmail: string | null;
  hasLogo: boolean;
  emailEnabled: boolean;
  updatedAt: string;
}

export interface BillingPackage {
  id: string;
  name: string;
  description: string | null;
  unitPrice: string;
  vatRate: number;
  modules: string[];
  active: boolean;
  stripePriceId: string | null;
  updatedAt: string;
}

export interface BillingCustomer {
  id: string;
  customerNumber: number;
  name: string;
  orgNumber: string | null;
  invoiceEmail: string | null;
  invoiceAddress: string | null;
  contactName: string | null;
  status: "active" | "suspended";
  trialEndsAt: string | null;
  accessUntil: string | null;
  open: boolean;
  invoices: number;
  outstanding: string;
  agreements: number;
}

export interface RecurringInvoice {
  id: string;
  organizationId: string;
  organizationName: string;
  name: string;
  customerNumber: number;
  lines: { kind?: "package" | "text" | "fee"; packageId?: string | null; description: string; quantity: number; unitPrice: number; vatRate: number }[];
  intervalMonths: 1 | 3 | 6 | 12;
  nextDate: string;
  sendDate: string;
  daysBefore: number | null;
  grantAccess: boolean;
  active: boolean;
  paused: boolean;
  updatedAt: string;
}

export interface BillingOverview {
  mrr: string;
  invoicedMonth: string;
  invoicedYear: string;
  outstanding: string;
  overdue: string;
  drafts: number;
  scheduled: number;
  missed: number;
}

export const INVOICE_STATUS: Record<InvoiceStatus, string> = {
  draft: "Utkast",
  scheduled: "Planlagt",
  sent: "Sendt",
  paid: "Betalt",
  credited: "Kreditert",
  payment_missed: "Betaling uteblitt",
};
export const PAYMENT_METHOD = { bank: "Bank", stripe: "Stripe", other: "Annet" } as const;
export const INTERVAL: Record<RecurringInvoice["intervalMonths"], string> = { 1: "Hver måned", 3: "Hvert kvartal", 6: "Hvert halvår", 12: "Hvert år" };
export const VAT_RATES = [0.25, 0.15, 0.12, 0] as const;

const nok = new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function kr(value: string | number | null): string {
  // A no-break space, so an amount never breaks before "kr".
  return value === null ? "–" : `${nok.format(Number(value))}\u00a0kr`;
}

export function percent(rate: number): string {
  return `${Math.round(rate * 100)}\u00a0%`;
}

// 12345678903 as "1234 56 78903".
export function formatAccount(value: string | null | undefined): string {
  return value && /^\d{11}$/.test(value) ? `${value.slice(0, 4)} ${value.slice(4, 6)} ${value.slice(6)}` : (value ?? "");
}

// Opens a PDF from the API (with the session cookie) in a new tab.
export async function openPdf(path: string): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const res = await fetch(`${API_URL}${path}`, { credentials: "include" });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Fikk ikke laget PDF-en.");
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (error) {
    tab?.close();
    throw error;
  }
}

export function invoiceTitle(i: Pick<InvoiceSummary, "kind" | "number">): string {
  const kind = i.kind === "credit" ? "Kreditnota" : "Faktura";
  return i.number === null ? `${kind} (utkast)` : `${kind} ${i.number}`;
}
