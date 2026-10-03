"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ErrorMessage, secondaryButton, LoadState } from "@/components/admin/field";
import { LanguagePicker } from "@/components/language-picker";
import { BankIdButton, VippsButton } from "@/components/provider-buttons";
import { API_URL } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { usePageTitle } from "@/lib/use-page-title";
import { formatKroner, formatOrgNumber, type OfferDocument } from "@/lib/work";

interface View {
  status: "pending" | "accepted" | "rejected" | "revoked" | "expired";
  // Only while the link is open; afterwards just the status is shown.
  document: OfferDocument | null;
  documentHash: string;
  expiresAt: string;
  decidedAt: string | null;
}

// The customer's page for accepting a sale made on the phone (docs/plan.md, section 14). Public:
// the secret link is the only key, and the customer identifies with BankID or Vipps to accept.
export default function ConfirmPage() {
  const router = useRouter();
  const t = useTranslations("confirm");
  const tc = useTranslations("common");
  // The secret is in the fragment (/bekreft#<token>), which is never sent to a server or logged.
  const [token] = useState(() => (typeof window === "undefined" ? "" : window.location.hash.slice(1)));
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState(false);
  const [busy, setBusy] = useState(false);
  usePageTitle(`${t("pageTitle")} · VeriQall`);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/confirm?t=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) setError(t("invalidLink"));
        else if (!res.ok) setError(tc("noServer"));
        else setView((await res.json()) as View);
      })
      .catch(() => !cancelled && setError(tc("noServer")));
    return () => {
      cancelled = true;
    };
  }, [token, t, tc]);

  async function decline() {
    if (!window.confirm(t("declineConfirm"))) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/confirm/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = (await res.json().catch(() => ({}))) as { result?: string };
      router.push(`/bekreft/ferdig?resultat=${encodeURIComponent(body.result ?? "feil")}`);
    } catch {
      setError(tc("noServer"));
      setBusy(false);
    }
  }

  if (!view) return <LoadState error={error} />;
  if (view.status !== "pending" || !view.document) {
    return (
      <section className="mx-auto flex max-w-2xl flex-col gap-4">
        <h1 className="text-3xl font-extrabold tracking-tight">{t("offer")}</h1>
        <p className="rounded-xl border border-line bg-surface p-4 sm:p-6" role="status">
          {t(`closed.${view.status === "pending" ? "expired" : view.status}`)}
          {view.decidedAt && ` (${formatDateTime(view.decidedAt)})`}
        </p>
        <p className="text-xs text-muted [overflow-wrap:anywhere]">{tc("documentId", { hash: view.documentHash })}</p>
        <LanguagePicker signedIn={false} />
      </section>
    );
  }
  const d = view.document;
  const price = [
    d.price.monthly !== null && tc("perMonth", { amount: formatKroner(d.price.monthly) }),
    d.price.once !== null && (d.price.monthly !== null ? tc("once", { amount: formatKroner(d.price.once) }) : formatKroner(d.price.once)),
  ].filter(Boolean);
  const orgNumber = (n: string | null) => n && tc("orgNumber", { number: formatOrgNumber(n) });
  const rows: [string, string][] = [
    [t("product"), d.product.name],
    [t("price"), price.length ? price.join(" + ") : "–"],
    [t("bindingPeriod"), tc("months", { count: d.bindingMonths })],
    [t("noticePeriod"), tc("months", { count: d.noticeMonths })],
    [t("withdrawalPeriod"), tc("days", { count: d.withdrawalDays })],
    [t("seller"), [d.seller.company, orgNumber(d.seller.orgNumber)].filter(Boolean).join(", ")],
    [t("customer"), [d.customer.name, orgNumber(d.customer.orgNumber)].filter(Boolean).join(", ")],
    [t("call"), formatDateTime(d.soldAt)],
  ];

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <div className="mb-4 flex justify-end">
          <LanguagePicker signedIn={false} />
        </div>
        <p className="text-sm font-medium uppercase tracking-wide text-muted">{d.seller.company}</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-2">{t("intro", { salesperson: d.seller.salesperson ?? t("aSeller"), company: d.seller.company })}</p>
      </div>

      <div className="rounded-xl border border-line bg-surface p-4 sm:p-6">
        <h2 className="text-xl font-bold">{t("theOffer")}</h2>
        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-sm font-semibold text-muted">{label}</dt>
              <dd className="[overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
        {d.withdrawalDays > 0 && (
          <p className="mt-4 rounded-lg bg-bg p-3">{t("withdrawal", { count: d.withdrawalDays })}</p>
        )}
        <h3 className="mt-6 font-bold">{t("terms")}</h3>
        <div className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-bg p-3 [overflow-wrap:anywhere]">{d.terms}</div>
      </div>
      <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 sm:p-6">
        <p className="text-sm text-muted">{t("answerBy", { date: formatDate(view.expiresAt) })}</p>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1" checked={read} onChange={(e) => setRead(e.target.checked)} />
          <span>{t("readAndAccept")}</span>
        </label>
        <p className="text-sm text-muted">{t("buyerOnly")}</p>
        <ErrorMessage message={error} />
        <div className="flex max-w-md flex-col gap-3">
          <BankIdButton href={`${API_URL}/confirm/bankid/start?t=${encodeURIComponent(token)}`} disabled={!read}>
            {t("acceptBankId")}
          </BankIdButton>
          <VippsButton href={`${API_URL}/confirm/vipps/start?t=${encodeURIComponent(token)}`} disabled={!read}>
            {t("acceptVipps")}
          </VippsButton>
          <button type="button" disabled={busy} className={secondaryButton} onClick={decline}>
            {t("decline")}
          </button>
        </div>
      </div>
      <p className="text-xs text-muted [overflow-wrap:anywhere]">{tc("documentId", { hash: view.documentHash })}</p>
      <LanguagePicker signedIn={false} />
    </section>
  );
}
