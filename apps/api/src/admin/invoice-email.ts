// The invoice as an e-mail (docs/plan.md, section 17): the whole invoice in the message, so the
// recipient needs no login to read or pay it.
import { DEFAULT_LOCALE, type Locale } from "@veriqall/shared";
import { emailHtml, escapeHtml } from "../email.ts";
import { DOCUMENT_TEXTS, formatKroner, formatLongDate, formatQuantity } from "../i18n/documents.ts";

interface Party {
  name?: string | null;
  orgNumber?: string | null;
  address?: string | null;
  email?: string | null;
  accountNumber?: string | null;
  vatRegistered?: boolean;
  footer?: string | null;
}

export interface InvoiceForEmail {
  kind: "invoice" | "credit";
  number: number | null;
  issueDate: string | null;
  dueDate: string | null;
  note: string | null;
  subtotal: string;
  vat: string;
  total: string;
  creditOfNumber: number | null;
  seller: Party | null;
  recipient: Party | null;
  lines: { description: string; quantity: string; unitPrice: string; vatRate: number; amount: string }[];
}

const orgNo = (v: string | null | undefined) => (v && /^\d{9}$/.test(v) ? `${v.slice(0, 3)} ${v.slice(3, 6)} ${v.slice(6)}` : (v ?? ""));
const account = (v: string | null | undefined) => (v && /^\d{11}$/.test(v) ? `${v.slice(0, 4)} ${v.slice(4, 6)} ${v.slice(6)}` : (v ?? ""));

// In the language of the call centre the invoice is for.
export function invoiceEmail(i: InvoiceForEmail, locale: Locale = DEFAULT_LOCALE): { subject: string; text: string; html: string } {
  const t = DOCUMENT_TEXTS[locale].invoice;
  const kr = (v: string | number) => formatKroner(locale, v);
  const date = (v: string | null) => formatLongDate(locale, v);
  const quantity = (v: string) => formatQuantity(locale, v);
  const percent = (rate: number) => t.percent(Math.round(rate * 100));
  const title = t.title(i.kind === "credit" ? t.creditNote : t.invoice, String(i.number), i.seller?.name ?? "VeriQall");
  const seller = i.seller ?? {};
  const recipient = i.recipient ?? {};
  const pay =
    i.kind === "invoice"
      ? t.pay(kr(i.total), account(seller.accountNumber), date(i.dueDate), String(i.number))
      : t.credit(String(i.creditOfNumber ?? ""));

  const text = [
    title,
    "",
    `${t.issueDate}: ${date(i.issueDate)}`,
    ...(i.kind === "invoice" ? [`${t.dueDate}: ${date(i.dueDate)}`] : []),
    `${t.to}: ${recipient.name ?? ""}${recipient.orgNumber ? `, ${t.orgNoInText} ${orgNo(recipient.orgNumber)}` : ""}`,
    ...(i.note ? ["", i.note] : []),
    "",
    ...i.lines.map((l) => `${l.description}: ${quantity(l.quantity)} × ${kr(l.unitPrice)} = ${kr(l.amount)} (${t.lineVat(percent(l.vatRate))})`),
    "",
    `${t.subtotal}: ${kr(i.subtotal)}`,
    `${t.vat}: ${kr(i.vat)}`,
    `${t.total}: ${kr(i.total)}`,
    "",
    pay,
    "",
    `${seller.name ?? ""}${seller.orgNumber ? `, ${t.orgNoInText} ${orgNo(seller.orgNumber)}${seller.vatRegistered ? " MVA" : ""}` : ""}`,
    ...(seller.address ? [seller.address] : []),
    ...(seller.email ? [seller.email] : []),
    ...(seller.footer ? ["", seller.footer] : []),
  ].join("\n");

  const cell = "padding:8px;border-bottom:1px solid #e5e5e5";
  const rows = i.lines
    .map(
      (l) => `<tr><td style="${cell}">${escapeHtml(l.description)}</td><td style="${cell};text-align:right">${escapeHtml(quantity(l.quantity))}</td>
<td style="${cell};text-align:right">${kr(l.unitPrice)}</td><td style="${cell};text-align:right">${percent(l.vatRate)}</td><td style="${cell};text-align:right">${kr(l.amount)}</td></tr>`,
    )
    .join("");
  const html = emailHtml(
    title,
    `<h1 style="font-size:22px;margin:0 0 4px">${escapeHtml(title)}</h1>
<p style="margin:0 0 16px;color:#555">${escapeHtml(t.issueDate)} ${escapeHtml(date(i.issueDate))}${i.kind === "invoice" ? `, ${escapeHtml(t.dueDate.toLowerCase())} ${escapeHtml(date(i.dueDate))}` : ""}</p>
<p style="margin:0 0 16px"><strong>${escapeHtml(t.to)}:</strong> ${escapeHtml(recipient.name ?? "")}${recipient.orgNumber ? `, ${escapeHtml(t.orgNoInText)} ${escapeHtml(orgNo(recipient.orgNumber))}` : ""}${recipient.address ? `<br>${escapeHtml(recipient.address).replace(/\n/g, "<br>")}` : ""}</p>
${i.note ? `<p style="white-space:pre-wrap">${escapeHtml(i.note)}</p>` : ""}
<table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr style="color:#555;text-align:left">
<th style="${cell}">${escapeHtml(t.description)}</th><th style="${cell};text-align:right">${escapeHtml(t.quantity)}</th><th style="${cell};text-align:right">${escapeHtml(t.price)}</th><th style="${cell};text-align:right">${escapeHtml(t.vat)}</th><th style="${cell};text-align:right">${escapeHtml(t.amount)}</th></tr></thead>
<tbody>${rows}</tbody></table>
<table style="margin:16px 0 0 auto;font-size:15px"><tr><td style="padding:2px 16px;color:#555">${escapeHtml(t.subtotal)}</td><td style="text-align:right">${kr(i.subtotal)}</td></tr>
<tr><td style="padding:2px 16px;color:#555">${escapeHtml(t.vat)}</td><td style="text-align:right">${kr(i.vat)}</td></tr>
<tr><td style="padding:2px 16px;font-weight:700">${escapeHtml(t.total)}</td><td style="text-align:right;font-weight:700">${kr(i.total)}</td></tr></table>
<p style="margin-top:24px;padding:12px;background:#f4f4f4;border-radius:8px">${escapeHtml(pay)}</p>
<p style="font-size:14px;color:#555">${escapeHtml(seller.name ?? "")}${seller.orgNumber ? `, ${escapeHtml(t.orgNoInText)} ${escapeHtml(orgNo(seller.orgNumber))}${seller.vatRegistered ? " MVA" : ""}` : ""}${seller.address ? `<br>${escapeHtml(seller.address).replace(/\n/g, "<br>")}` : ""}${seller.email ? `<br>${escapeHtml(seller.email)}` : ""}</p>
${seller.footer ? `<p style="font-size:13px;color:#666;white-space:pre-wrap">${escapeHtml(seller.footer)}</p>` : ""}`,
    locale,
  );
  return { subject: title, text, html };
}
