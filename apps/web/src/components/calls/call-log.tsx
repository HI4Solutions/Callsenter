"use client";

import { useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, secondaryButton } from "@/components/admin/field";
import { formatDateTime } from "@/lib/format";
import { orgFetch } from "@/lib/org";

interface LogEntry {
  at: string;
  userName: string | null;
  text: string;
}

interface CallLogResponse {
  access: { at: string; action: "view" | "play" | "download"; resource: string; userName: string | null }[];
  changes: {
    at: string;
    action: "insert" | "update" | "delete";
    table: string;
    userName: string | null;
    fromStatus: string | null;
    toStatus: string | null;
    flag: string | null;
    reviewedAt: string | null;
    templateName: string | null;
  }[];
}

const STATUS: Record<string, string> = {
  recording: "tar opp",
  processing: "sendt til transkribering",
  transcribed: "transkribert",
  analyzed: "ferdig behandlet",
  failed: "feilet",
};
const FLAG: Record<string, string> = { green: "godkjent", yellow: "avvik", red: "brudd" };

function describe(log: CallLogResponse): LogEntry[] {
  const access = log.access.map((a) => ({
    at: a.at,
    userName: a.userName,
    text:
      a.resource === "call_search"
        ? "Så et utdrag i et søk"
        : a.action === "play"
          ? "Spilte av opptaket"
          : a.action === "download"
            ? "Lastet ned opptaket"
            : "Åpnet samtalen",
  }));
  const changes = log.changes.map((c) => {
    let text = "Endret samtalen";
    if (c.table === "calls" && c.action === "insert") text = "Startet opptaket";
    else if (c.table === "calls" && c.action === "delete") text = "Samtalen ble slettet";
    else if (c.table === "calls" && c.toStatus && c.toStatus !== c.fromStatus) text = `Status: ${STATUS[c.toStatus] ?? c.toStatus}`;
    else if (c.table === "calls") text = "Endret koblinger eller tilleggsinformasjon";
    else if (c.table === "call_analyses" && c.action === "insert") text = `AI-kontroll: ${c.flag ? FLAG[c.flag] ?? c.flag : "ferdig"}`;
    else if (c.table === "call_analyses") text = "Behandlet flagget";
    else if (c.table === "reports") text = `Ba om nytt notat${c.templateName ? ` (${c.templateName})` : ""}`;
    else if (c.table === "report_edits") text = "Justerte notatet";
    return { at: c.at, userName: c.userName, text };
  });
  return [...access, ...changes].sort((a, b) => b.at.localeCompare(a.at));
}

// The call's log for leaders with audit.read: who opened and played it, and what was done with
// it. Loaded on request, since opening the log is not a view of the call itself.
export function CallLog({ callId }: { callId: string }) {
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setError(null);
    setBusy(true);
    try {
      setEntries(describe(await orgFetch<CallLogResponse>(`/calls/${callId}/log`)));
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Card
      title="Logg"
      actions={
        <button type="button" className={secondaryButton} disabled={busy} onClick={load}>
          {entries ? "Oppdater" : "Vis logg"}
        </button>
      }
    >
      <ErrorMessage message={error} />
      {!entries ? (
        <p className="text-muted">Hvem som har åpnet, spilt av og behandlet samtalen, og når.</p>
      ) : entries.length === 0 ? (
        <p className="text-muted">Ingen hendelser.</p>
      ) : (
        <ol className="divide-y divide-line">
          {entries.map((e, i) => (
            <li key={i} className="grid gap-x-4 py-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <span className="text-sm text-muted tabular-nums">{formatDateTime(e.at)}</span>
              <span className="[overflow-wrap:anywhere]">
                {e.text}
                {e.userName && <span className="text-muted"> · {e.userName}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
