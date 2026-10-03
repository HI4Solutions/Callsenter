import { useTranslations } from "next-intl";
import { Flag } from "@/components/flag";
import { FLAG_LEVEL, formatDuration } from "@/lib/calls";
import type { SaleDocumentation } from "@/lib/complaints";
import { formatDateTime } from "@/lib/format";
import {
  days,
  formatOrgNumber,
  formatPhone,
  formatPrice,
  months,
} from "@/lib/work";

const METHOD: Record<string, string> = { bankid: "BankID", vipps: "Vipps" };

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
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
  const t = useTranslations("work.documentation");
  const td = useTranslations("domain");
  const tc = useTranslations("common");
  const s = doc.sale;
  const accepted = doc.confirmations.find((c) => c.status === "accepted");
  return (
    <div className="flex flex-col gap-6">
      <Section title={t("sale")}>
        <Rows
          rows={[
            [t("callCentre"), s.organizationName],
            [
              t("customer"),
              `${s.customerName} (${td(`customerKind.${s.customerKind}`)}${s.customerOrgNumber ? `, ${tc("orgNumber", { number: formatOrgNumber(s.customerOrgNumber) })}` : ""})`,
            ],
            [
              t("contact"),
              [s.customerPhone && formatPhone(s.customerPhone), s.customerEmail]
                .filter(Boolean)
                .join(", ") || "–",
            ],
            [
              t("seller"),
              [s.sellerName, s.teamName].filter(Boolean).join(", ") || "–",
            ],
            [t("registered"), formatDateTime(s.soldAt)],
            [t("status"), td(`saleStatus.${s.status}`)],
          ]}
        />
      </Section>

      <Section
        title={t("offer", {
          product: s.productName,
          version: s.templateVersion,
        })}
      >
        <Rows
          rows={[
            [t("price"), formatPrice(s)],
            [t("binding"), months(s.bindingMonths)],
            [t("notice"), months(s.noticeMonths)],
            [t("withdrawal"), days(s.withdrawalDays)],
          ]}
        />
        <h3 className="mt-4 font-bold">{t("requiredPoints")}</h3>
        <ol className="mt-1 list-decimal pl-6">
          {s.requiredPoints.map((p) => (
            <li key={p.id}>{p.text}</li>
          ))}
        </ol>
        <h3 className="mt-4 font-bold">{t("terms")}</h3>
        <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {s.terms}
        </p>
      </Section>

      <Section title={t("acceptance")}>
        {accepted ? (
          <Rows
            rows={[
              [t("accepted"), formatDateTime(accepted.decidedAt)],
              [
                t("method"),
                accepted.method
                  ? accepted.method === "none"
                    ? t("withoutId")
                    : METHOD[accepted.method]
                  : "–",
              ],
              [
                t("identity"),
                [
                  accepted.identityName,
                  accepted.identityPhone && formatPhone(accepted.identityPhone),
                ]
                  .filter(Boolean)
                  .join(", ") || "–",
              ],
              [
                t("match"),
                accepted.identityMatch === "phone"
                  ? t("matchPhone")
                  : accepted.identityMatch === "name"
                    ? t("matchName")
                    : t("matchNone"),
              ],
              [t("ip"), accepted.ip ?? "–"],
              [
                t("documentId"),
                <span key="h" className="font-mono text-sm">
                  {accepted.documentHash}
                </span>,
              ],
            ]}
          />
        ) : (
          <p>
            {doc.confirmations.length
              ? t("notAccepted", { state: doc.confirmations[0]!.status })
              : t("notSent")}
          </p>
        )}
      </Section>

      {doc.calls.map((c) => (
        <Section
          key={c.id}
          title={t("call", {
            date: formatDateTime(c.startedAt),
            duration: formatDuration(c.durationMs),
          })}
        >
          <p className="text-sm text-muted">{c.userName}</p>
          {c.analysis && (
            <div className="mt-3">
              <div className="flex flex-wrap items-center gap-2">
                <Flag level={FLAG_LEVEL[c.analysis.flag]} />
                <span>{c.analysis.summary}</span>
              </div>
              <ul className="mt-3 flex flex-col gap-3">
                {c.analysis.findings.map((f, i) => (
                  <li
                    key={i}
                    className="flex flex-col items-start gap-1.5 sm:flex-row sm:gap-3"
                  >
                    <span className="shrink-0">
                      <Flag level={FLAG_LEVEL[f.level]} />
                    </span>
                    <span className="min-w-0 pt-0.5 [overflow-wrap:anywhere]">
                      <strong>{f.label}</strong>{" "}
                      <span className="text-muted">
                        ({td(`findingKind.${f.kind}`)})
                      </span>
                      {f.quote && (
                        <>
                          {" "}
                          – «{f.quote}»
                          {f.startMs !== null &&
                            ` [${formatDuration(f.startMs)}]`}
                        </>
                      )}
                      {f.comment && (
                        <span className="text-muted"> {f.comment}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {c.analysis.reviewedAt && (
                <p className="mt-2 text-sm">
                  {c.analysis.reviewedByName
                    ? t("reviewedBy", {
                        date: formatDateTime(c.analysis.reviewedAt),
                        name: c.analysis.reviewedByName,
                      })
                    : t("reviewed", {
                        date: formatDateTime(c.analysis.reviewedAt),
                      })}
                  {c.analysis.reviewNote && `: ${c.analysis.reviewNote}`}
                </p>
              )}
            </div>
          )}
          {c.report && (
            <>
              <h3 className="mt-4 font-bold">
                {t("note", { template: c.report.templateName })}
              </h3>
              <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
                {c.report.content}
              </p>
              {c.report.aiContent && (
                <>
                  <p className="mt-2 text-sm text-muted">
                    {c.report.editedAt
                      ? t("editedAt", {
                          name: c.report.editedByName ?? t("theSeller"),
                          date: formatDateTime(c.report.editedAt),
                        })
                      : t("edited", {
                          name: c.report.editedByName ?? t("theSeller"),
                        })}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
                    {c.report.aiContent}
                  </p>
                </>
              )}
            </>
          )}
          {c.segments.length > 0 && (
            <>
              <h3 className="mt-4 font-bold">{t("transcription")}</h3>
              <ol className="mt-1 flex flex-col gap-1 text-sm">
                {c.segments.map((seg, i) => (
                  <li key={i} className="[overflow-wrap:anywhere]">
                    <span className="font-mono text-muted">
                      {formatDuration(seg.startMs)}
                    </span>{" "}
                    {seg.speaker && (
                      <strong>{t("speaker", { speaker: seg.speaker })}</strong>
                    )}
                    {seg.text}
                  </li>
                ))}
              </ol>
            </>
          )}
        </Section>
      ))}
      {doc.calls.length === 0 && (
        <Section title={t("calls")}>
          <p>{t("noCalls")}</p>
        </Section>
      )}

      <Section title={t("history")}>
        <ol className="flex flex-col gap-1">
          {doc.events.map((e, i) => (
            <li key={i}>
              {formatDateTime(e.createdAt)}: {td(`saleStatus.${e.toStatus}`)}
              {e.actorName && ` (${e.actorName})`}
              {e.note && ` – ${e.note}`}
            </li>
          ))}
        </ol>
      </Section>
      <p className="text-sm text-muted">
        {t("generated", { date: formatDateTime(doc.generatedAt) })}
      </p>
    </div>
  );
}
