"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorMessage, primaryButton, secondaryButton, LoadState } from "@/components/admin/field";
import { API_URL } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { usePageTitle } from "@/lib/use-page-title";
import { days, formatOrgNumber, formatPrice, months, type OfferDocument } from "@/lib/work";

interface View {
  status: "pending" | "accepted" | "rejected" | "revoked" | "expired";
  // Only while the link is open; afterwards just the status is shown.
  document: OfferDocument | null;
  documentHash: string;
  expiresAt: string;
  decidedAt: string | null;
}

const CLOSED: Record<Exclude<View["status"], "pending">, string> = {
  accepted: "Du har godtatt dette tilbudet.",
  rejected: "Du har avslått dette tilbudet.",
  revoked: "Denne lenken er erstattet eller trukket tilbake. Ta kontakt med selgeren hvis du venter på et tilbud.",
  expired: "Fristen for å svare på tilbudet har gått ut. Ta kontakt med selgeren hvis du fortsatt ønsker avtalen.",
};

// The customer's page for accepting a sale made on the phone (docs/plan.md, section 14). Public:
// the secret link is the only key, and the customer identifies with BankID or Vipps to accept.
export default function ConfirmPage() {
  const router = useRouter();
  // The secret is in the fragment (/bekreft#<token>), which is never sent to a server or logged.
  const [token] = useState(() => (typeof window === "undefined" ? "" : window.location.hash.slice(1)));
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState(false);
  const [busy, setBusy] = useState(false);
  usePageTitle("Bekreft avtale · VeriQall");

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/confirm?t=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) setError("Lenken er ugyldig. Sjekk at du har brukt hele lenken.");
        else if (!res.ok) setError("Får ikke kontakt med serveren. Prøv igjen om litt.");
        else setView((await res.json()) as View);
      })
      .catch(() => !cancelled && setError("Får ikke kontakt med serveren. Prøv igjen om litt."));
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function decline() {
    if (!window.confirm("Avslå tilbudet? Avtalen blir da ikke inngått.")) return;
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
      setError("Får ikke kontakt med serveren. Prøv igjen om litt.");
      setBusy(false);
    }
  }

  if (!view) return <LoadState error={error} />;
  if (view.status !== "pending" || !view.document) {
    return (
      <section className="mx-auto flex max-w-2xl flex-col gap-4">
        <h1 className="text-3xl font-extrabold tracking-tight">Tilbud</h1>
        <p className="rounded-xl border border-line bg-surface p-4 sm:p-6" role="status">
          {CLOSED[view.status === "pending" ? "expired" : view.status]}
          {view.decidedAt && ` (${formatDateTime(view.decidedAt)})`}
        </p>
        <p className="text-xs text-muted [overflow-wrap:anywhere]">Dokument-ID: {view.documentHash}</p>
      </section>
    );
  }
  const d = view.document;
  const rows: [string, string][] = [
    ["Produkt", d.product.name],
    ["Pris", formatPrice({ priceOnce: d.price.once, priceMonthly: d.price.monthly })],
    ["Bindingstid", months(d.bindingMonths)],
    ["Oppsigelsestid", months(d.noticeMonths)],
    ["Angrefrist", days(d.withdrawalDays)],
    ["Selger", [d.seller.company, d.seller.orgNumber && `org.nr. ${formatOrgNumber(d.seller.orgNumber)}`].filter(Boolean).join(", ")],
    ["Kunde", [d.customer.name, d.customer.orgNumber && `org.nr. ${formatOrgNumber(d.customer.orgNumber)}`].filter(Boolean).join(", ")],
    ["Samtale", formatDateTime(d.soldAt)],
  ];

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-muted">{d.seller.company}</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">Bekreft avtalen</h1>
        <p className="mt-2">
          Du har snakket med {d.seller.salesperson ?? "en selger"} fra {d.seller.company} på telefon. Avtalen er først inngått når du godtar
          tilbudet skriftlig her.
        </p>
      </div>

      <div className="rounded-xl border border-line bg-surface p-4 sm:p-6">
        <h2 className="text-xl font-bold">Tilbudet</h2>
        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-sm font-semibold text-muted">{label}</dt>
              <dd className="[overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
        {d.withdrawalDays > 0 && (
          <p className="mt-4 rounded-lg bg-bg p-3">
            Du har {days(d.withdrawalDays).toLowerCase()} angrerett. Du kan gå fra avtalen uten å oppgi grunn innen fristen.
          </p>
        )}
        <h3 className="mt-6 font-bold">Vilkår</h3>
        <div className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-bg p-3 [overflow-wrap:anywhere]">{d.terms}</div>
      </div>
      <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 sm:p-6">
        <p className="text-sm text-muted">Svar innen {formatDate(view.expiresAt)}.</p>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1" checked={read} onChange={(e) => setRead(e.target.checked)} />
          <span>Jeg har lest tilbudet og vilkårene, og vil inngå avtalen.</span>
        </label>
        <p className="text-sm text-muted">Tilbudet må godtas av kjøperen selv. Du godtar ved å identifisere deg, og vi bruker bare navnet ditt (og mobilnummeret ved Vipps) som bevis.</p>
        <ErrorMessage message={error} />
        <div className="flex flex-wrap gap-2">
          <a
            href={read ? `${API_URL}/confirm/bankid/start?t=${encodeURIComponent(token)}` : undefined}
            aria-disabled={!read}
            className={`${primaryButton} ${read ? "" : "pointer-events-none opacity-60"}`}
          >
            Godta med BankID
          </a>
          <a
            href={read ? `${API_URL}/confirm/vipps/start?t=${encodeURIComponent(token)}` : undefined}
            aria-disabled={!read}
            className={`${primaryButton} ${read ? "" : "pointer-events-none opacity-60"}`}
          >
            Godta med Vipps
          </a>
          <button type="button" disabled={busy} className={secondaryButton} onClick={decline}>
            Avslå
          </button>
        </div>
      </div>
      <p className="text-xs text-muted [overflow-wrap:anywhere]">Dokument-ID: {view.documentHash}</p>
    </section>
  );
}
