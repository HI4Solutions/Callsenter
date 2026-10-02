// The invoice as a PDF (docs/plan.md, section 16): A4, the seller's logo if one is uploaded,
// and the whole invoice. A draft is marked FAKTURAUTKAST and has no number.
import { degrees, PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";

interface Party {
  name?: string | null;
  orgNumber?: string | null;
  address?: string | null;
  email?: string | null;
  accountNumber?: string | null;
  vatRegistered?: boolean;
  footer?: string | null;
  contactName?: string | null;
  customerNumber?: number | string | null;
}

export interface InvoiceForPdf {
  kind: "invoice" | "credit";
  status: string;
  number: number | null;
  issueDate: string | null;
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
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
// Helvetica (WinAnsi) has no narrow no-break space; Intl uses it as the thousands separator.
const kr = (v: string | number) => `${nok.format(Number(v)).replace(/[  ]/g, " ").replace("−", "-")} kr`;
const date = (v: string | null) => {
  if (!v) return "";
  const [y, m, d] = v.split("-");
  return `${d}.${m}.${y}`;
};
const orgNo = (v: string | null | undefined) => (v && /^\d{9}$/.test(v) ? `${v.slice(0, 3)} ${v.slice(3, 6)} ${v.slice(6)}` : (v ?? ""));
const account = (v: string | null | undefined) => (v && /^\d{11}$/.test(v) ? `${v.slice(0, 4)} ${v.slice(4, 6)} ${v.slice(6)}` : (v ?? ""));
// Characters Helvetica cannot draw are replaced, so odd input never breaks the PDF.
const safe = (v: string) => v.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7e\xa0-\xff–—€]/g, "?");

export interface Logo {
  bytes: Uint8Array;
  type: "image/png" | "image/jpeg";
}

export async function invoicePdf(i: InvoiceForPdf, logo?: Logo | null, draftPreview?: { seller: Party; recipient: Party }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const draft = i.status === "draft" || i.status === "scheduled";
  const seller = i.seller ?? draftPreview?.seller ?? {};
  const recipient = i.recipient ?? draftPreview?.recipient ?? {};
  const title = i.kind === "credit" ? "Kreditnota" : "Faktura";
  doc.setTitle(draft ? `${title} (utkast)` : `${title} ${i.number}`);
  doc.setAuthor(seller.name ?? "");

  const A4: [number, number] = [595.28, 841.89];
  const margin = 50;
  const muted = rgb(0.4, 0.4, 0.4);
  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - margin;

  const text = (s: string, x: number, at: number, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; right?: boolean } = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 10;
    const value = safe(s);
    const width = font.widthOfTextAtSize(value, size);
    page.drawText(value, { x: opts.right ? x - width : x, y: at, size, font, color: opts.color ?? rgb(0.1, 0.1, 0.1) });
  };
  // Wraps text to a width, returning the lines.
  const wrap = (s: string, width: number, font: PDFFont = regular, size = 10) => {
    const out: string[] = [];
    for (const paragraph of safe(s).split("\n")) {
      let line = "";
      for (const word of paragraph.split(" ")) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > width && line) {
          out.push(line);
          line = word;
        } else line = next;
      }
      out.push(line);
    }
    return out;
  };
  const newPageIfNeeded = (needed: number) => {
    if (y - needed < margin + 40) {
      page = doc.addPage(A4);
      y = A4[1] - margin;
    }
  };

  if (draft) {
    page.drawText("FAKTURAUTKAST", { x: 120, y: 380, size: 64, font: bold, color: rgb(0.85, 0.85, 0.85), rotate: degrees(35) });
  }

  // Header: logo (or the seller's name) to the left, title and numbers to the right.
  let headerBottom = y;
  if (logo) {
    const image = logo.type === "image/png" ? await doc.embedPng(logo.bytes) : await doc.embedJpg(logo.bytes);
    const scale = Math.min(160 / image.width, 50 / image.height, 1);
    page.drawImage(image, { x: margin, y: y - image.height * scale, width: image.width * scale, height: image.height * scale });
    headerBottom = y - image.height * scale;
  } else if (seller.name) {
    text(seller.name, margin, y - 16, { font: bold, size: 16 });
    headerBottom = y - 20;
  }
  const right = A4[0] - margin;
  text(draft ? `${title} (utkast)` : `${title} ${i.number}`, right, y - 16, { font: bold, size: 18, right: true });
  let ry = y - 36;
  const fact = (label: string, value: string) => {
    text(label, right - 110, ry, { color: muted, right: true });
    text(value, right, ry, { right: true });
    ry -= 14;
  };
  fact("Fakturadato", draft ? (i.issueDate ? date(i.issueDate) : "Ved sending") : date(i.issueDate));
  if (i.kind === "invoice") fact("Forfall", i.dueDate ? date(i.dueDate) : "Ved sending");
  if (recipient.customerNumber) fact("Kundenummer", String(recipient.customerNumber));
  if (i.kind === "credit" && i.creditOfNumber) fact("Krediterer faktura", String(i.creditOfNumber));
  if (i.periodStart && i.periodEnd) fact("Periode", `${date(i.periodStart)}–${date(i.periodEnd)}`);
  y = Math.min(headerBottom, ry) - 24;

  // Seller and recipient.
  const col = (lines: string[], x: number, startY: number, heading: string) => {
    text(heading, x, startY, { color: muted, size: 9 });
    let at = startY - 14;
    for (const [n, line] of lines.entries()) {
      text(line, x, at, { font: n === 0 ? bold : regular });
      at -= 13;
    }
    return at;
  };
  const to = [
    recipient.name ?? "",
    ...(recipient.orgNumber ? [`Org.nr. ${orgNo(recipient.orgNumber)}`] : []),
    ...(recipient.contactName ? [`Att. ${recipient.contactName}`] : []),
    ...(recipient.address ? recipient.address.split("\n") : []),
    ...(recipient.email ? [recipient.email] : []),
  ];
  const from = [
    seller.name ?? "",
    ...(seller.orgNumber ? [`Org.nr. ${orgNo(seller.orgNumber)}${seller.vatRegistered ? " MVA" : ""}`] : []),
    ...(seller.address ? seller.address.split("\n") : []),
    ...(seller.email ? [seller.email] : []),
  ];
  y = Math.min(col(to, margin, y, "Til"), col(from, 320, y, "Fra")) - 16;

  if (i.note) {
    for (const line of wrap(i.note, A4[0] - 2 * margin)) {
      newPageIfNeeded(14);
      text(line, margin, y);
      y -= 13;
    }
    y -= 10;
  }

  // Lines.
  const cols = { desc: margin, qty: 360, price: 435, vat: 475, amount: right };
  const header = () => {
    text("Beskrivelse", cols.desc, y, { color: muted, size: 9 });
    text("Antall", cols.qty, y, { color: muted, size: 9, right: true });
    text("Pris", cols.price, y, { color: muted, size: 9, right: true });
    text("Mva", cols.vat, y, { color: muted, size: 9, right: true });
    text("Beløp", cols.amount, y, { color: muted, size: 9, right: true });
    y -= 6;
    page.drawLine({ start: { x: margin, y }, end: { x: right, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    y -= 14;
  };
  header();
  for (const l of i.lines) {
    const desc = wrap(l.description, cols.qty - cols.desc - 50);
    newPageIfNeeded(desc.length * 12 + 6);
    if (y > A4[1] - margin - 1) header();
    text(desc[0]!, cols.desc, y);
    text(Number(l.quantity).toLocaleString("nb-NO").replace(/[\u202f\u00a0]/g, " ").replace("\u2212", "-"), cols.qty, y, { right: true });
    text(kr(l.unitPrice), cols.price, y, { right: true });
    text(`${Math.round(l.vatRate * 100)} %`, cols.vat, y, { right: true });
    text(kr(l.amount), cols.amount, y, { right: true });
    for (const more of desc.slice(1)) {
      y -= 12;
      text(more, cols.desc, y);
    }
    y -= 16;
  }
  page.drawLine({ start: { x: margin, y: y + 8 }, end: { x: right, y: y + 8 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });

  // Totals.
  newPageIfNeeded(70);
  y -= 6;
  const total = (label: string, value: string, strong = false) => {
    text(label, right - 120, y, { color: strong ? undefined : muted, font: strong ? bold : regular, right: true, size: strong ? 12 : 10 });
    text(value, right, y, { font: strong ? bold : regular, right: true, size: strong ? 12 : 10 });
    y -= strong ? 18 : 14;
  };
  total("Sum eks. mva", kr(i.subtotal));
  total("Mva", kr(i.vat));
  total(i.kind === "credit" ? "Til gode" : "Å betale", kr(i.total), true);

  // Payment.
  if (i.kind === "invoice" && seller.accountNumber) {
    newPageIfNeeded(50);
    y -= 14;
    page.drawRectangle({ x: margin, y: y - 30, width: right - margin, height: 44, color: rgb(0.95, 0.95, 0.95) });
    text(`Kontonummer: ${account(seller.accountNumber)}`, margin + 10, y - 2, { font: bold });
    text(
      draft ? "Merk betalingen med fakturanummeret (tildeles ved sending)." : `Merk betalingen med fakturanummer ${i.number}. Forfall ${date(i.dueDate)}.`,
      margin + 10,
      y - 18,
    );
    y -= 46;
  }
  if (seller.footer) {
    for (const line of wrap(seller.footer, right - margin, regular, 9)) {
      newPageIfNeeded(12);
      text(line, margin, y, { size: 9, color: muted });
      y -= 11;
    }
  }
  return doc.save();
}
