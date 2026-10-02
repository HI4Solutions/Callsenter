import { SALE_STATUSES } from "@veriqall/shared";
import { Flag } from "@/components/flag";
import { FINDING_KIND, FLAG_LEVEL, formatDuration } from "@/lib/calls";
import type { SaleDocumentation } from "@/lib/complaints";
import { formatDateTime } from "@/lib/format";
import { CUSTOMER_KIND, days, formatOrgNumber, formatPhone, formatPrice, months } from "@/lib/work";

const METHOD: Record<string, string> = { bankid: "BankID", vipps: "Vipps", none: "uten identifisering" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid-page rounded-xl border border-line bg-surface p-4 sm:p-6 print:rounded-none print:border-0 print:border-t print:p-0 print:pt-4">
      <h2 className="text-xl font-bold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[12rem_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-sm font-semibold text-muted">{label}</dt>
          <dd className="[overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// Everything about a sale in one document (module 9): offered, said, accepted, and what happened.
export function SaleDocumentationView({ doc }: { doc: SaleDocumentation }) {
  const s = doc.sale;
  const accepted = doc.confirmations.find((c) => c.status === "accepted");
  return (
    <div className="flex flex-col gap-6">
      <Section title="Salget">
        <Rows
          rows={[
            ["Callsenter", s.organizationName],
            ["Kunde", `${s.customerName} (${CUSTOMER_KIND[s.customerKind]}${s.customerOrgNumber ? `, org.nr. ${formatOrgNumber(s.customerOrgNumber)}` : ""})`],
            ["Kontakt", [s.customerPhone && formatPhone(s.customerPhone), s.customerEmail].filter(Boolean).join(", ") || "–"],
            ["Selger", [s.sellerName, s.teamName].filter(Boolean).join(", ") || "–"],
            ["Registrert", formatDateTime(s.soldAt)],
            ["Status", SALE_STATUSES[s.status]],
          ]}
        />
      </Section>

      <Section title={`Tilbudet (${s.productName}, malversjon ${s.templateVersion})`}>
        <Rows
          rows={[
            ["Pris", formatPrice(s)],
            ["Bindingstid", months(s.bindingMonths)],
            ["Oppsigelsestid", months(s.noticeMonths)],
            ["Angrefrist", days(s.withdrawalDays)],
          ]}
        />
        <h3 className="mt-4 font-bold">Obligatoriske punkter i malen</h3>
        <ol className="mt-1 list-decimal pl-6">
          {s.requiredPoints.map((p) => (
            <li key={p.id}>{p.text}</li>
          ))}
        </ol>
        <h3 className="mt-4 font-bold">Vilkår</h3>
        <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{s.terms}</p>
      </Section>

      <Section title="Kundens aksept">
        {accepted ? (
          <Rows
            rows={[
              ["Godtatt", formatDateTime(accepted.decidedAt)],
              ["Metode", accepted.method ? METHOD[accepted.method] : "–"],
              ["Identitet", [accepted.identityName, accepted.identityPhone && formatPhone(accepted.identityPhone)].filter(Boolean).join(", ") || "–"],
              [
                "Samsvar med kunden",
                accepted.identityMatch === "phone" ? "Mobilnummer stemmer" : accepted.identityMatch === "name" ? "Navn stemmer" : "Stemmer ikke, kontrolleres",
              ],
              ["IP-adresse", accepted.ip ?? "–"],
              ["Dokument-ID (SHA-256)", <span key="h" className="font-mono text-sm">{accepted.documentHash}</span>],
            ]}
          />
        ) : (
          <p>
            {doc.confirmations.length
              ? `Ikke godtatt. Siste lenke: ${doc.confirmations[0]!.status === "rejected" ? "avslått av kunden" : doc.confirmations[0]!.status === "pending" ? "venter på kunden" : "trukket tilbake"}.`
              : "Ikke sendt til kunden for skriftlig aksept."}
          </p>
        )}
      </Section>

      {doc.calls.map((c) => (
        <Section key={c.id} title={`Samtale ${formatDateTime(c.startedAt)} (${formatDuration(c.durationMs)})`}>
          <p className="text-sm text-muted">{c.userName}</p>
          {c.analysis && (
            <div className="mt-3">
              <div className="flex flex-wrap items-center gap-2">
                <Flag level={FLAG_LEVEL[c.analysis.flag]} />
                <span>{c.analysis.summary}</span>
              </div>
              <ul className="mt-2 flex flex-col gap-1">
                {c.analysis.findings.map((f, i) => (
                  <li key={i} className="[overflow-wrap:anywhere]">
                    <strong>{f.label}</strong> ({FINDING_KIND[f.kind]}, {f.level === "green" ? "godkjent" : f.level === "yellow" ? "avvik" : "brudd"})
                    {f.quote && <> – «{f.quote}»{f.startMs !== null && ` [${formatDuration(f.startMs)}]`}</>}
                    {f.comment && <span className="text-muted"> {f.comment}</span>}
                  </li>
                ))}
              </ul>
              {c.analysis.reviewedAt && (
                <p className="mt-2 text-sm">
                  Behandlet {formatDateTime(c.analysis.reviewedAt)}
                  {c.analysis.reviewedByName && ` av ${c.analysis.reviewedByName}`}
                  {c.analysis.reviewNote && `: ${c.analysis.reviewNote}`}
                </p>
              )}
            </div>
          )}
          {c.report && (
            <>
              <h3 className="mt-4 font-bold">Rapport ({c.report.templateName})</h3>
              <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{c.report.content}</p>
            </>
          )}
          {c.segments.length > 0 && (
            <>
              <h3 className="mt-4 font-bold">Transkripsjon</h3>
              <ol className="mt-1 flex flex-col gap-1 text-sm">
                {c.segments.map((seg, i) => (
                  <li key={i} className="[overflow-wrap:anywhere]">
                    <span className="font-mono text-muted">{formatDuration(seg.startMs)}</span> {seg.speaker && <strong>Taler {seg.speaker}: </strong>}
                    {seg.text}
                  </li>
                ))}
              </ol>
            </>
          )}
        </Section>
      ))}
      {doc.calls.length === 0 && (
        <Section title="Samtaler">
          <p>Ingen samtaler er koblet til salget, eller du har ikke tilgang til dem.</p>
        </Section>
      )}

      <Section title="Historikk">
        <ol className="flex flex-col gap-1">
          {doc.events.map((e, i) => (
            <li key={i}>
              {formatDateTime(e.createdAt)}: {SALE_STATUSES[e.toStatus]}
              {e.actorName && ` (${e.actorName})`}
              {e.note && ` – ${e.note}`}
            </li>
          ))}
        </ol>
      </Section>
      <p className="text-sm text-muted">Dokumentasjonen er laget {formatDateTime(doc.generatedAt)} av VeriQall.</p>
    </div>
  );
}
