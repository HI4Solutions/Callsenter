import { useTranslations } from "next-intl";
import { formatOrgNumber } from "@/lib/work";
import { formatAccount, type InvoiceDetail, kr, percent } from "@/lib/billing";
import { formatDate, formatTagNow } from "@/lib/format";
import { useInvoiceTitle } from "./invoice-status";

// The invoice as a document, for the screen and for printing (or saving as PDF). A draft shows
// the call centre's current details; a sent invoice shows what was frozen when it was sent.
export function InvoiceView({ invoice }: { invoice: InvoiceDetail }) {
  const t = useTranslations("economy.view");
  const te = useTranslations("economy.shared");
  const invoiceTitle = useInvoiceTitle();
  const seller = invoice.seller;
  const recipient = invoice.recipient ?? {
    name: invoice.organizationName,
    orgNumber: invoice.organizationOrgNumber,
    address: invoice.organizationInvoiceAddress,
    email: invoice.organizationInvoiceEmail,
  };
  const outstanding = Number(invoice.total) - Number(invoice.paid);
  return (
    <article className="flex flex-col gap-8 rounded-xl border border-line bg-surface p-4 sm:p-8 print:border-0 print:p-0">
      <header className="flex flex-wrap justify-between gap-6">
        <div>
          <h2 className="text-2xl font-extrabold">{invoiceTitle(invoice)}</h2>
          {invoice.kind === "credit" && invoice.creditOfNumber && (
            <p className="text-muted">
              {t("credits", { number: invoice.creditOfNumber })}
            </p>
          )}
        </div>
        {seller && (
          <div className="text-sm sm:text-right">
            <p className="font-semibold">{seller.name}</p>
            {seller.orgNumber && (
              <p>
                {t(seller.vatRegistered ? "orgNumberVat" : "orgNumber", {
                  number: formatOrgNumber(seller.orgNumber),
                })}
              </p>
            )}
            {seller.address && (
              <p className="whitespace-pre-line">{seller.address}</p>
            )}
            {seller.email && <p>{seller.email}</p>}
          </div>
        )}
      </header>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="text-sm">
          <p className="font-semibold text-muted">{t("to")}</p>
          <p className="font-semibold">{recipient.name}</p>
          {recipient.orgNumber && (
            <p>
              {t("orgNumber", { number: formatOrgNumber(recipient.orgNumber) })}
            </p>
          )}
          {recipient.contactName && (
            <p>{t("attention", { name: recipient.contactName })}</p>
          )}
          {recipient.address && (
            <p className="whitespace-pre-line">{recipient.address}</p>
          )}
          {recipient.email && <p>{recipient.email}</p>}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm sm:justify-self-end">
          <dt className="text-muted">{te("invoiceDate")}</dt>
          <dd>
            {invoice.issueDate
              ? formatDate(invoice.issueDate)
              : t("setOnSending")}
          </dd>
          {invoice.kind === "invoice" && (
            <>
              <dt className="text-muted">{te("dueDate")}</dt>
              <dd>
                {invoice.dueDate
                  ? formatDate(invoice.dueDate)
                  : t("setOnSending")}
              </dd>
            </>
          )}
          {invoice.number !== null && (
            <>
              <dt className="text-muted">{t("invoiceNumber")}</dt>
              <dd>{invoice.number}</dd>
            </>
          )}
        </dl>
      </div>

      {invoice.note && (
        <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
          {invoice.note}
        </p>
      )}

      <div className="-mx-2 scroll-x">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="border-b border-line text-muted">
            <tr>
              <th className="px-2 py-2 font-semibold">{t("description")}</th>
              <th className="px-2 py-2 text-right font-semibold">
                {t("quantity")}
              </th>
              <th className="px-2 py-2 text-right font-semibold">
                {t("price")}
              </th>
              <th className="px-2 py-2 text-right font-semibold">{t("vat")}</th>
              <th className="px-2 py-2 text-right font-semibold">
                {t("amount")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {invoice.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-2 py-2 [overflow-wrap:anywhere]">
                  {l.description}
                </td>
                <td className="px-2 py-2 text-right">
                  {Number(l.quantity).toLocaleString(formatTagNow())}
                </td>
                <td className="px-2 py-2 text-right">{kr(l.unitPrice)}</td>
                <td className="px-2 py-2 text-right">{percent(l.vatRate)}</td>
                <td className="px-2 py-2 text-right">{kr(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 self-end text-right">
        <dt className="text-muted">{t("subtotal")}</dt>
        <dd>{kr(invoice.subtotal)}</dd>
        <dt className="text-muted">{t("vat")}</dt>
        <dd>{kr(invoice.vat)}</dd>
        <dt className="font-bold">{t("toPay")}</dt>
        <dd className="font-bold">{kr(invoice.total)}</dd>
        {Number(invoice.paid) > 0 && (
          <>
            <dt className="text-muted">{t("paid")}</dt>
            <dd>{kr(invoice.paid)}</dd>
            <dt className="text-muted">{t("remaining")}</dt>
            <dd>{kr(outstanding)}</dd>
          </>
        )}
      </dl>

      {seller && invoice.kind === "invoice" && (
        <footer className="flex flex-col gap-1 border-t border-line pt-4 text-sm">
          <p>
            {invoice.number !== null
              ? t.rich("payToWithNumber", {
                  account: formatAccount(seller.accountNumber),
                  number: invoice.number,
                  b: (c) => <strong>{c}</strong>,
                })
              : t.rich("payTo", {
                  account: formatAccount(seller.accountNumber),
                  b: (c) => <strong>{c}</strong>,
                })}
          </p>
          {seller.footer && (
            <p className="whitespace-pre-wrap text-muted">{seller.footer}</p>
          )}
        </footer>
      )}
    </article>
  );
}
