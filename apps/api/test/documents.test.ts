// E-mails and the invoice PDF in the recipient call centre's language (src/i18n/documents.ts).
import { inflateSync } from "node:zlib";
import { LOCALE_CODES } from "@veriqall/shared";
import { describe, expect, it } from "vitest";
import { invoiceEmail } from "../src/admin/invoice-email.ts";
import { invoicePdf, type InvoiceForPdf } from "../src/admin/invoice-pdf.ts";
import { invitationEmail } from "../src/email.ts";
import { DOCUMENT_TEXTS } from "../src/i18n/documents.ts";

// The text drawn on a pdf-lib PDF: its content streams hold the strings as <hex> Tj.
function pdfText(pdf: Uint8Array): string {
  const raw = Buffer.from(pdf);
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const start = raw.indexOf("stream", at);
    if (start < 0) break;
    const begin = start + (raw[start + 6] === 0x0d ? 8 : 7);
    const end = raw.indexOf("endstream", begin);
    let content: string;
    try {
      content = inflateSync(raw.subarray(begin, end)).toString("latin1");
    } catch {
      content = raw.subarray(begin, end).toString("latin1");
    }
    for (const m of content.matchAll(/<([0-9A-Fa-f]*)> Tj/g))
      out.push(Buffer.from(m[1]!, "hex").toString("latin1"));
    at = end + 9;
  }
  return out.join("\n");
}

const invoice = (
  kind: "invoice" | "credit" = "invoice",
  status = "sent",
): InvoiceForPdf => ({
  kind,
  status,
  number: 12,
  issueDate: "2026-10-03",
  dueDate: "2026-10-17",
  periodStart: null,
  periodEnd: null,
  note: null,
  subtotal: "1234.5",
  vat: "308.63",
  total: "1543.13",
  creditOfNumber: kind === "credit" ? 11 : null,
  seller: {
    name: "Leverandør AS",
    orgNumber: "999999999",
    accountNumber: "12345678903",
    vatRegistered: true,
  },
  recipient: { name: "Call Centre Ltd", customerNumber: 1001 },
  lines: [
    {
      description: "Licence",
      quantity: "1",
      unitPrice: "1234.5",
      vatRate: 0.25,
      amount: "1234.5",
    },
  ],
});

describe("documents in the call centre's language", () => {
  it("has every text in every language", () => {
    const keys = (o: object) =>
      JSON.stringify(
        Object.fromEntries(
          Object.entries(o).map(([k, v]) => [k, Object.keys(v).sort()]),
        ),
      );
    for (const locale of LOCALE_CODES)
      expect(keys(DOCUMENT_TEXTS[locale])).toBe(keys(DOCUMENT_TEXTS.nb));
  });

  it("writes the invitation e-mail in English", () => {
    const email = invitationEmail(
      "Kari",
      "North Calls",
      "https://app.test/logg-inn?invitasjon=x",
      "en",
    );
    expect(email.subject).toBe("Invitation to North Calls in VeriQall");
    expect(email.text).toBe(
      "Hi Kari,\n\nYou have been invited to North Calls in VeriQall. Sign in with BankID or Vipps using the link below:\n\nhttps://app.test/logg-inn?invitasjon=x\n\nThe link is personal and can only be used once.",
    );
    expect(email.html).toContain('<html lang="en">');
    expect(email.html).toContain(
      "You have been invited to <strong>North Calls</strong> in VeriQall.",
    );
    expect(email.html).toContain("Accept the invitation");
    // Norwegian stays as it was.
    expect(invitationEmail("Kari", "Nord", "https://x", "nb").subject).toBe(
      "Invitasjon til Nord i VeriQall",
    );
  });

  it("writes the invoice e-mail in English, with English dates and amounts", () => {
    const email = invoiceEmail(invoice(), "en");
    expect(email.subject).toBe("Invoice 12 from Leverandør AS");
    expect(email.text).toContain("Invoice date: 3 October 2026");
    expect(email.text).toContain("Due date: 17 October 2026");
    expect(email.text).toContain(
      "Licence: 1 × NOK 1,234.50 = NOK 1,234.50 (VAT 25%)",
    );
    expect(email.text).toContain("Amount due: NOK 1,543.13");
    expect(email.text).toContain(
      "Pay NOK 1,543.13 to account 1234 56 78903 by 17 October 2026, and mark the payment with invoice number 12.",
    );
    expect(email.html).toContain(
      '<th style="padding:8px;border-bottom:1px solid #e5e5e5">Description</th>',
    );
    expect(email.html).not.toMatch(/Fakturadato|Å betale|Beløp/);
    expect(invoiceEmail(invoice("credit"), "de").subject).toBe(
      "Gutschrift 12 von Leverandør AS",
    );
  });

  it("makes the invoice PDF in English", async () => {
    const text = pdfText(await invoicePdf(invoice(), null, undefined, "en"));
    for (const expected of [
      "Invoice 12",
      "Invoice date",
      "03/10/2026",
      "Customer number",
      "Description",
      "Total excl. VAT",
      "Amount due",
      "NOK 1,543.13",
      "Account number: 1234 56 78903",
      "Mark the payment with invoice number 12. Due 17/10/2026.",
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toMatch(/Fakturadato|Å betale|Kundenummer/);
    const draft = pdfText(
      await invoicePdf(
        { ...invoice(), status: "draft", number: null },
        null,
        undefined,
        "en",
      ),
    );
    expect(draft).toContain("DRAFT INVOICE");
    expect(draft).toContain("Invoice (draft)");
    // Norwegian as before.
    const nb = pdfText(await invoicePdf(invoice()));
    expect(nb).toContain("Fakturadato");
    expect(nb).toContain("1 543,13 kr");
    expect(nb).toContain("03.10.2026");
  });
});
