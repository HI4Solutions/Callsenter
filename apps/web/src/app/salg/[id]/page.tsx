"use client";

import { SALE_TRANSITIONS, type SaleStatus } from "@veriqall/shared";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import {
  ErrorMessage,
  Field,
  inputClass,
  primaryButton,
  secondaryButton,
  LoadState,
} from "@/components/admin/field";
import { LinkedCalls } from "@/components/work/linked-calls";
import { SaleStatusBadge } from "@/components/work/sale-status";
import { useWorkMe } from "@/components/work/work-shell";
import { formatDateTime } from "@/lib/format";
import { orgFetch } from "@/lib/org";
import { StatusBadge } from "@/components/admin/status-badge";
import {
  days,
  formatPhone,
  formatPrice,
  months,
  type SaleDetail,
} from "@/lib/work";

export default function SalePage() {
  const { id } = useParams<{ id: string }>();
  const me = useWorkMe();
  const t = useTranslations("sales.detail");
  const td = useTranslations("domain");
  const canManage = me?.permissions.includes("sales.manage") ?? false;
  const canSeeCustomers = me?.permissions.includes("customers.read") ?? false;
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      orgFetch<SaleDetail>(`/sales/${id}`)
        .then(setSale)
        .catch((e: Error) => setError(e.message)),
    [id],
  );

  useEffect(() => {
    let cancelled = false;
    orgFetch<SaleDetail>(`/sales/${id}`)
      .then((s) => !cancelled && setSale(s))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!sale) return <LoadState error={error} />;

  const rows: [string, React.ReactNode][] = [
    [
      t("customer"),
      canSeeCustomers ? (
        <Link
          href={`/kunder/${sale.customerId}`}
          className="font-semibold text-brand"
        >
          {sale.customerName}
        </Link>
      ) : (
        (sale.customerName ?? "–")
      ),
    ],
    ...(sale.customerKind
      ? ([[t("customerKind"), td(`customerKind.${sale.customerKind}`)]] as [
          string,
          string,
        ][])
      : []),
    ...(sale.customerPhone
      ? ([[t("phone"), formatPhone(sale.customerPhone)]] as [string, string][])
      : []),
    [
      t("product"),
      <Link
        key="p"
        href={`/produkter/${sale.productId}`}
        className="font-semibold text-brand"
      >
        {t("productLink", {
          name: sale.productName,
          version: sale.templateVersion,
        })}
      </Link>,
    ],
    [t("price"), formatPrice(sale)],
    [t("binding"), months(sale.bindingMonths)],
    [t("withdrawal"), days(sale.withdrawalDays)],
    [
      t("seller"),
      [sale.sellerName, sale.teamName].filter(Boolean).join(", ") || "–",
    ],
    [t("registered"), formatDateTime(sale.soldAt)],
  ];

  return (
    <section className="flex flex-col gap-8">
      <div>
        <Link
          href="/salg"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-brand"
        >
          {t("back")}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight">
            {sale.productName}
          </h1>
          <SaleStatusBadge status={sale.status} />
        </div>
        <p className="mt-2 text-muted">{sale.customerName}</p>
        {me?.modules?.includes("documentation") && (
          <Link
            href={`/salg/${sale.id}/dokumentasjon`}
            className="mt-3 inline-flex font-semibold text-brand"
          >
            {t("documentation")}
          </Link>
        )}
      </div>
      <ErrorMessage message={error} />
      <Card title={t("card")}>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[12rem_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-sm font-semibold text-muted">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
        {sale.note && (
          <p className="mt-4 whitespace-pre-wrap [overflow-wrap:anywhere] rounded-lg bg-bg p-3">
            {sale.note}
          </p>
        )}
      </Card>
      {canManage && SALE_TRANSITIONS[sale.status].length > 0 && (
        <StatusActions
          key={sale.status}
          sale={sale}
          onChanged={load}
          onError={setError}
        />
      )}
      <Confirmations
        sale={sale}
        canManage={
          canManage && (me?.modules?.includes("sale_verification") ?? false)
        }
        onChanged={load}
      />
      <LinkedCalls query={`saleId=${sale.id}`} />
      <Card title={t("history")}>
        <ol className="flex flex-col gap-4">
          {[...sale.events].reverse().map((e) => (
            <li key={e.id} className="border-l-2 border-line pl-4">
              <p className="font-semibold">{td(`saleStatus.${e.toStatus}`)}</p>
              <p className="text-sm text-muted">
                {formatDateTime(e.createdAt)}
                {e.actorName && ` · ${e.actorName}`}
              </p>
              {e.note && (
                <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {e.note}
                </p>
              )}
            </li>
          ))}
        </ol>
      </Card>
    </section>
  );
}

// Rejected, withdrawn and cancelled end the sale for good.
const FINAL: readonly SaleStatus[] = ["rejected", "withdrawn", "cancelled"];

function StatusActions({
  sale,
  onChanged,
  onError,
}: {
  sale: SaleDetail;
  onChanged: () => Promise<unknown>;
  onError: (message: string | null) => void;
}) {
  const t = useTranslations("sales.status");
  const td = useTranslations("domain");
  const tw = useTranslations("work");
  const [next, setNext] = useState<SaleStatus | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const forward = SALE_TRANSITIONS[sale.status].filter(
    (s) => !FINAL.includes(s),
  );
  const ending = SALE_TRANSITIONS[sale.status].filter((s) => FINAL.includes(s));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!next) return;
    onError(null);
    setBusy(true);
    try {
      await orgFetch(`/sales/${sale.id}`, {
        method: "PATCH",
        body: { status: next, statusNote: note.trim() || null },
      });
      await onChanged();
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  }

  const final = next !== null && FINAL.includes(next);
  return (
    <Card title={t("title")}>
      {next ? (
        <form onSubmit={save} className="flex flex-col gap-4">
          <p>
            {t.rich("newStatus", {
              status: td(`saleStatus.${next}`),
              b: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
          {final && <p>{t("final")}</p>}
          <Field
            label={t("reason")}
            hint={final ? t("reasonFinalHint") : t("reasonHint")}
          >
            <textarea
              rows={2}
              maxLength={1000}
              className={`${inputClass} py-2`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className={final ? secondaryButton : primaryButton}
            >
              {t("saveAs", { status: td(`saleStatus.${next}`).toLowerCase() })}
            </button>
            <button
              type="button"
              className={secondaryButton}
              onClick={() => setNext(null)}
            >
              {tw("cancel")}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          {forward.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {forward.map((status, i) => (
                <button
                  key={status}
                  type="button"
                  className={i === 0 ? primaryButton : secondaryButton}
                  onClick={() => setNext(status)}
                >
                  {td(`saleAction.${status}`)}
                </button>
              ))}
            </div>
          )}
          {ending.length > 0 && (
            <div
              className={`flex flex-wrap items-center gap-2 ${forward.length ? "border-t border-line pt-4" : ""}`}
            >
              <span className="text-sm text-muted">{t("endSale")}</span>
              {ending.map((status) => (
                <button
                  key={status}
                  type="button"
                  className={secondaryButton}
                  onClick={() => setNext(status)}
                >
                  {td(`saleAction.${status}`)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

const METHOD: Record<string, string> = { bankid: "BankID", vipps: "Vipps" };

// Written acceptance from the customer (module 8): a secret link the seller sends, where the
// customer reads the offer and accepts with BankID or Vipps.
function Confirmations({
  sale,
  canManage,
  onChanged,
}: {
  sale: SaleDetail;
  canManage: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const t = useTranslations("sales.confirmations");
  const tc = useTranslations("common");
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const canSend =
    canManage &&
    (sale.status === "registered" || sale.status === "awaiting_confirmation");
  if (!canSend && !sale.confirmations.length) return null;

  async function send() {
    const pending = sale.confirmations.some((c) => c.status === "pending");
    if (pending && !window.confirm(t("newLinkConfirm"))) return;
    setError(null);
    setCopied(false);
    try {
      setLink(
        await orgFetch<{ url: string; expiresAt: string }>(
          `/sales/${sale.id}/confirmations`,
          { method: "POST" },
        ),
      );
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm(t("revokeConfirm"))) return;
    setError(null);
    try {
      await orgFetch(`/sales/${sale.id}/confirmations/${id}/revoke`, {
        method: "POST",
      });
      setLink(null);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card
      title={t("title")}
      actions={
        canSend && (
          <button type="button" className={primaryButton} onClick={send}>
            {sale.confirmations.some((c) => c.status === "pending")
              ? t("newLink")
              : t("send")}
          </button>
        )
      }
    >
      <p className="text-muted">{t("intro")}</p>
      {link && (
        <div className="mt-4 flex flex-col gap-2 rounded-lg bg-bg p-3">
          <p className="font-semibold">{t("sendThis")}</p>
          <p className="font-mono text-sm [overflow-wrap:anywhere]">
            {link.url}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={secondaryButton}
              onClick={() =>
                navigator.clipboard.writeText(link.url).then(
                  () => setCopied(true),
                  () => setCopied(false),
                )
              }
            >
              {t("copy")}
            </button>
            {copied && <span role="status">{t("copied")}</span>}
          </div>
          <p className="text-sm text-muted">
            {t("shownOnce", { date: formatDateTime(link.expiresAt) })}
          </p>
        </div>
      )}
      <ErrorMessage message={error} />
      {sale.confirmations.length > 0 && (
        <ul className="mt-4 divide-y divide-line">
          {sale.confirmations.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                {c.status === "pending" &&
                new Date(c.expiresAt) <= new Date() ? (
                  <span className="inline-flex items-center rounded-full border border-line px-3 py-1 text-sm font-medium">
                    {t("expired")}
                  </span>
                ) : c.status === "accepted" ? (
                  <StatusBadge tone="ok">{t(`state.${c.status}`)}</StatusBadge>
                ) : c.status === "rejected" ? (
                  <StatusBadge tone="danger">
                    {t(`state.${c.status}`)}
                  </StatusBadge>
                ) : c.status === "pending" ? (
                  <StatusBadge tone="warning">
                    {t(`state.${c.status}`)}
                  </StatusBadge>
                ) : (
                  <span className="inline-flex items-center rounded-full border border-line px-3 py-1 text-sm font-medium">
                    {t(`state.${c.status}`)}
                  </span>
                )}
                <span className="text-sm text-muted">
                  {c.createdByName
                    ? t("sentBy", {
                        date: formatDateTime(c.createdAt),
                        name: c.createdByName,
                      })
                    : t("sent", { date: formatDateTime(c.createdAt) })}
                  {c.viewedAt &&
                    `, ${t("opened", { date: formatDateTime(c.viewedAt) })}`}
                </span>
              </div>
              {c.decidedAt && (
                <p className="text-sm">
                  {t(c.status === "accepted" ? "acceptedAt" : "rejectedAt", {
                    date: formatDateTime(c.decidedAt),
                  })}
                  {c.method &&
                    ` ${c.method === "none" ? t("withoutId") : t("withMethod", { method: METHOD[c.method] ?? c.method })}`}
                  {c.identityName &&
                    ` ${t("byName", { name: c.identityName })}`}
                  {c.identityPhone && ` (${formatPhone(c.identityPhone)})`}
                  {c.ip && `, ${t("fromIp", { ip: c.ip })}`}.
                </p>
              )}
              {c.status === "accepted" && c.identityMatch === "none" && (
                <p className="text-sm font-semibold">{t("mismatch")}</p>
              )}
              <p className="font-mono text-xs text-muted [overflow-wrap:anywhere]">
                {tc("documentId", { hash: c.documentHash })}
              </p>
              {c.status === "pending" &&
                canManage &&
                new Date(c.expiresAt) > new Date() && (
                  <div>
                    <button
                      type="button"
                      className={secondaryButton}
                      onClick={() => revoke(c.id)}
                    >
                      {t("revoke")}
                    </button>
                  </div>
                )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
