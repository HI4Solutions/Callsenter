// Sale documentation and complaints (apps/api/src/org/documentation.ts and complaints.ts).
import type { Finding, Level } from "./calls";
import type { Confirmation, OfferDocument } from "./work";
import type { SaleStatus } from "@veriqall/shared";

export interface SaleDocumentation {
  sale: {
    id: string;
    status: SaleStatus;
    soldAt: string;
    priceOnce: string | null;
    priceMonthly: string | null;
    bindingMonths: number;
    withdrawalDays: number;
    noticeMonths: number;
    note: string | null;
    customerId: string;
    customerName: string;
    customerKind: "person" | "business";
    customerOrgNumber: string | null;
    customerPhone: string | null;
    customerEmail: string | null;
    productId: string;
    productName: string;
    templateVersion: number;
    terms: string;
    requiredPoints: { id: string; text: string }[];
    sellerName: string | null;
    teamName: string | null;
    organizationName: string;
  };
  acceptedDocument: OfferDocument | null;
  confirmations: Confirmation[];
  calls: {
    id: string;
    title: string | null;
    startedAt: string;
    durationMs: number | null;
    status: string;
    userName: string | null;
    segments: { speaker: string | null; startMs: number; text: string }[];
    analysis: {
      flag: Level;
      summary: string;
      findings: Finding[];
      createdAt: string;
      reviewedAt: string | null;
      reviewedByName: string | null;
      reviewNote: string | null;
    } | null;
    report: { templateName: string; content: string } | null;
  }[];
  events: { fromStatus: SaleStatus | null; toStatus: SaleStatus; note: string | null; actorName: string | null; createdAt: string }[];
  generatedAt: string;
}

export type ComplaintStatus = "open" | "investigating" | "resolved" | "rejected";
export type Channel = "phone" | "email" | "letter" | "web" | "other";

export const COMPLAINT_STATUS: Record<ComplaintStatus, string> = {
  open: "Ny",
  investigating: "Under behandling",
  resolved: "Løst",
  rejected: "Avvist",
};

export const CHANNEL: Record<Channel, string> = {
  phone: "Telefon",
  email: "E-post",
  letter: "Brev",
  web: "Nettskjema",
  other: "Annet",
};

export function complaintTone(status: ComplaintStatus): "ok" | "warning" | "danger" | null {
  if (status === "resolved") return "ok";
  if (status === "investigating") return "warning";
  if (status === "open") return "danger";
  return null;
}

export interface ComplaintSummary {
  id: string;
  status: ComplaintStatus;
  channel: Channel;
  receivedOn: string;
  summary: string;
  closedAt: string | null;
  customerId: string;
  customerName: string;
  saleId: string | null;
  productName: string | null;
  assignedName: string | null;
  updatedAt: string;
}

export interface ComplaintDetail extends Omit<ComplaintSummary, "productName" | "updatedAt"> {
  description: string;
  outcome: string | null;
  createdAt: string;
  customerPhone: string | null;
  customerEmail: string | null;
  assignedTo: string | null;
  createdByName: string | null;
  events: {
    id: string;
    kind: "created" | "status" | "note";
    fromStatus: ComplaintStatus | null;
    toStatus: ComplaintStatus | null;
    note: string | null;
    actorName: string | null;
    createdAt: string;
  }[];
  documentation: SaleDocumentation | null;
  documentationHidden: boolean;
}
