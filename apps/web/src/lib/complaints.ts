// Sale documentation and complaints (apps/api/src/org/documentation.ts and complaints.ts).
import type { Finding, Level } from "./calls";
import type { Confirmation, OfferDocument } from "./work";
import type { Locale, SaleStatus } from "@veriqall/shared";

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
    report: { templateName: string; content: string; aiContent: string | null; editedAt: string | null; editedByName: string | null } | null;
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
  // null for a complaint about a call without a customer in VeriQall.
  customerId: string | null;
  // null without access to customers.
  customerName: string | null;
  saleId: string | null;
  // The reference of the call the complaint is about (kept after the call is deleted).
  callReference: string | null;
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
  callId: string | null;
  // False when the case handler may not see the call (another seller's call needs BankID).
  callVisible: boolean;
  ai: ComplaintAi[];
}

// The AI's assessment of a complaint against its call (apps/api/src/calls/complaints.ts).
export type Verdict = "justified" | "partly" | "not_justified" | "unclear";
export type ClaimFinding = "supported" | "contradicted" | "not_found";

export interface ComplaintAssessment {
  verdict: Verdict;
  summary: string;
  claims: {
    claim: string;
    finding: ClaimFinding;
    quote: string | null;
    startMs: number | null;
    comment: string;
  }[];
  nextSteps: string;
}

export interface ComplaintAi {
  id: string;
  kind: "assessment" | "reply";
  status: "pending" | "done" | "failed";
  error: string | null;
  locale: Locale;
  result: ComplaintAssessment | null;
  // A reply as the case handler last adjusted it, else the AI's draft.
  content: string | null;
  aiContent: string | null;
  instructions: string | null;
  complaintText: string;
  createdAt: string;
  editedAt: string | null;
  requestedByName: string | null;
  editedByName: string | null;
}

// A call found by its reference, with the complaints already registered about it.
export interface CallLookup {
  call: {
    id: string;
    reference: string;
    status: string;
    startedAt: string;
    durationMs: number | null;
    userName: string | null;
    productName: string | null;
    customerId: string | null;
    customerName: string | null;
  };
  complaints: {
    id: string;
    summary: string;
    status: ComplaintStatus;
    receivedOn: string;
  }[];
}
