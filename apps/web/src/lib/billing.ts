import { API_URL } from "./auth";
import { formatTagNow } from "./format";

// Invoicing (apps/api/src/admin/billing.ts): Hi4 Solutions AS invoices the call centres.

export type InvoiceStatus =
  | "draft"
  | "scheduled"
  | "sent"
  | "paid"
  | "credited"
  | "payment_missed";

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
  payments: {
    id: string;
    amount: string;
    paidOn: string;
    method: "bank" | "stripe" | "other";
    reference: string | null;
    createdAt: string;
  }[];
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
  lines: {
    kind?: "package" | "text" | "fee";
    packageId?: string | null;
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
  }[];
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
export const PAYMENT_METHOD = {
  bank: "Bank",
  stripe: "Stripe",
  other: "Annet",
} as const;
export const INTERVAL: Record<RecurringInvoice["intervalMonths"], string> = {
  1: "Hver måned",
  3: "Hvert kvartal",
  6: "Hvert halvår",
  12: "Hvert år",
};
export const VAT_RATES = [0.25, 0.15, 0.12, 0] as const;

// Kroner in the page's language ("1 234,50 kr", "NOK 1,234.50"). Intl keeps the amount and the
// currency together with a no-break space.
export function kr(value: string | number | null): string {
  if (value === null) return "–";
  return new Intl.NumberFormat(formatTagNow(), {
    style: "currency",
    currency: "NOK",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

// Two decimals, or up to four below one dollar (a single AI call costs fractions of a cent).
export function usd(value: string | number | null): string {
  if (value === null) return "–";
  const n = Number(value);
  return new Intl.NumberFormat(formatTagNow(), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.abs(n) < 1 ? 4 : 2,
  }).format(n);
}

// "25 %" in Norwegian, "25%" in English.
export function percent(rate: number): string {
  return new Intl.NumberFormat(formatTagNow(), {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(rate);
}

// 12345678903 as "1234 56 78903".
export function formatAccount(value: string | null | undefined): string {
  return value && /^\d{11}$/.test(value)
    ? `${value.slice(0, 4)} ${value.slice(4, 6)} ${value.slice(6)}`
    : (value ?? "");
}

// Opens a PDF from the API (with the session cookie) in a new tab.
// fallbackError: shown when the API gives no reason (pages pass it in their language).
export async function openPdf(
  path: string,
  fallbackError = "Fikk ikke laget PDF-en.",
): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const res = await fetch(`${API_URL}${path}`, { credentials: "include" });
    if (!res.ok)
      throw new Error(
        (await res.json().catch(() => ({}))).error ?? fallbackError,
      );
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (error) {
    tab?.close();
    throw error;
  }
}

export function invoiceTitle(
  i: Pick<InvoiceSummary, "kind" | "number">,
): string {
  const kind = i.kind === "credit" ? "Kreditnota" : "Faktura";
  return i.number === null ? `${kind} (utkast)` : `${kind} ${i.number}`;
}
