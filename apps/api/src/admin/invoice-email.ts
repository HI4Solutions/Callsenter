// The invoice as an e-mail (docs/plan.md, section 17): the whole invoice in the message, so the
// recipient needs no login to read or pay it.
import { emailHtml, escapeHtml } from "../email.ts";

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

const nok = new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kr = (v: string | number) => `${nok.format(Number(v))} kr`;
const date = (v: string | null) => (v ? new Intl.DateTimeFormat("nb-NO", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${v}T00:00:00Z`)) : "");
const orgNo = (v: string | null | undefined) => (v && /^\d{9}$/.test(v) ? `${v.slice(0, 3)} ${v.slice(3, 6)} ${v.slice(6)}` : (v ?? ""));
const account = (v: string | null | undefined) => (v && /^\d{11}$/.test(v) ? `${v.slice(0, 4)} ${v.slice(4, 6)} ${v.slice(6)}` : (v ?? ""));

export function invoiceEmail(i: InvoiceForEmail): { subject: string; text: string; html: string } {
  const title = `${i.kind === "credit" ? "Kreditnota" : "Faktura"} ${i.number} fra ${i.seller?.name ?? "VeriQall"}`;
  const seller = i.seller ?? {};
  const recipient = i.recipient ?? {};
  const pay =
    i.kind === "invoice"
      ? `Betal ${kr(i.total)} til konto ${account(seller.accountNumber)} innen ${date(i.dueDate)}, og merk betalingen med fakturanummer ${i.number}.`
      : `Kreditnota for faktura ${i.creditOfNumber ?? ""}. Beløpet trekkes fra det dere skylder, eller betales tilbake.`;

  const text = [
    title,
    "",
    `Fakturadato: ${date(i.issueDate)}`,
    ...(i.kind === "invoice" ? [`Forfall: ${date(i.dueDate)}`] : []),
    `Til: ${recipient.name ?? ""}${recipient.orgNumber ? `, org.nr. ${orgNo(recipient.orgNumber)}` : ""}`,
    ...(i.note ? ["", i.note] : []),
    "",
    ...i.lines.map((l) => `${l.description}: ${Number(l.quantity).toLocaleString("nb-NO")} × ${kr(l.unitPrice)} = ${kr(l.amount)} (mva ${Math.round(l.vatRate * 100)} %)`),
    "",
    `Sum eks. mva: ${kr(i.subtotal)}`,
    `Mva: ${kr(i.vat)}`,
    `Å betale: ${kr(i.total)}`,
    "",
    pay,
    "",
    `${seller.name ?? ""}${seller.orgNumber ? `, org.nr. ${orgNo(seller.orgNumber)}${seller.vatRegistered ? " MVA" : ""}` : ""}`,
    ...(seller.address ? [seller.address] : []),
    ...(seller.email ? [seller.email] : []),
    ...(seller.footer ? ["", seller.footer] : []),
  ].join("\n");

  const cell = "padding:8px;border-bottom:1px solid #e5e5e5";
  const rows = i.lines
    .map(
      (l) => `<tr><td style="${cell}">${escapeHtml(l.description)}</td><td style="${cell};text-align:right">${escapeHtml(Number(l.quantity).toLocaleString("nb-NO"))}</td>
<td style="${cell};text-align:right">${kr(l.unitPrice)}</td><td style="${cell};text-align:right">${Math.round(l.vatRate * 100)} %</td><td style="${cell};text-align:right">${kr(l.amount)}</td></tr>`,
    )
    .join("");
  const html = emailHtml(
    title,
    `<h1 style="font-size:22px;margin:0 0 4px">${escapeHtml(title)}</h1>
<p style="margin:0 0 16px;color:#555">Fakturadato ${escapeHtml(date(i.issueDate))}${i.kind === "invoice" ? `, forfall ${escapeHtml(date(i.dueDate))}` : ""}</p>
<p style="margin:0 0 16px"><strong>Til:</strong> ${escapeHtml(recipient.name ?? "")}${recipient.orgNumber ? `, org.nr. ${escapeHtml(orgNo(recipient.orgNumber))}` : ""}${recipient.address ? `<br>${escapeHtml(recipient.address).replace(/\n/g, "<br>")}` : ""}</p>
${i.note ? `<p style="white-space:pre-wrap">${escapeHtml(i.note)}</p>` : ""}
<table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr style="color:#555;text-align:left">
<th style="${cell}">Beskrivelse</th><th style="${cell};text-align:right">Antall</th><th style="${cell};text-align:right">Pris</th><th style="${cell};text-align:right">Mva</th><th style="${cell};text-align:right">Beløp</th></tr></thead>
<tbody>${rows}</tbody></table>
<table style="margin:16px 0 0 auto;font-size:15px"><tr><td style="padding:2px 16px;color:#555">Sum eks. mva</td><td style="text-align:right">${kr(i.subtotal)}</td></tr>
<tr><td style="padding:2px 16px;color:#555">Mva</td><td style="text-align:right">${kr(i.vat)}</td></tr>
<tr><td style="padding:2px 16px;font-weight:700">Å betale</td><td style="text-align:right;font-weight:700">${kr(i.total)}</td></tr></table>
<p style="margin-top:24px;padding:12px;background:#f4f4f4;border-radius:8px">${escapeHtml(pay)}</p>
<p style="font-size:14px;color:#555">${escapeHtml(seller.name ?? "")}${seller.orgNumber ? `, org.nr. ${escapeHtml(orgNo(seller.orgNumber))}${seller.vatRegistered ? " MVA" : ""}` : ""}${seller.address ? `<br>${escapeHtml(seller.address).replace(/\n/g, "<br>")}` : ""}${seller.email ? `<br>${escapeHtml(seller.email)}` : ""}</p>
${seller.footer ? `<p style="font-size:13px;color:#666;white-space:pre-wrap">${escapeHtml(seller.footer)}</p>` : ""}`,
  );
  return { subject: title, text, html };
}
