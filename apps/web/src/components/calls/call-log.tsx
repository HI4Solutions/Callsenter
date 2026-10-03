"use client";

import { useTranslations } from "next-intl";
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
  access: {
    at: string;
    action: "view" | "play" | "download";
    resource: string;
    userName: string | null;
  }[];
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

const STATUSES = [
  "recording",
  "processing",
  "transcribed",
  "analyzed",
  "failed",
] as const;
const FLAGS = ["green", "yellow", "red"] as const;

function isOneOf<T extends string>(
  list: readonly T[],
  value: string | null,
): value is T {
  return value !== null && (list as readonly string[]).includes(value);
}

type LogT = ReturnType<typeof useTranslations<"calls.log">>;

function describe(log: CallLogResponse, t: LogT): LogEntry[] {
  const access = log.access.map((a) => ({
    at: a.at,
    userName: a.userName,
    text:
      a.resource === "call_search"
        ? t("searched")
        : a.action === "play"
          ? t("played")
          : a.action === "download"
            ? t("downloaded")
            : t("opened"),
  }));
  const changes = log.changes.map((c) => {
    let text = t("changed");
    if (c.table === "calls" && c.action === "insert") text = t("started");
    else if (c.table === "calls" && c.action === "delete") text = t("deleted");
    else if (c.table === "calls" && c.toStatus && c.toStatus !== c.fromStatus)
      text = t("status", {
        status: isOneOf(STATUSES, c.toStatus)
          ? t(`statusValue.${c.toStatus}`)
          : c.toStatus,
      });
    else if (c.table === "calls") text = t("linksChanged");
    else if (c.table === "call_analyses" && c.action === "insert")
      text = t("aiControl", {
        result: c.flag
          ? isOneOf(FLAGS, c.flag)
            ? t(`flagValue.${c.flag}`)
            : c.flag
          : t("done"),
      });
    else if (c.table === "call_analyses") text = t("reviewed");
    else if (c.table === "reports")
      text = c.templateName
        ? t("newNoteTemplate", { template: c.templateName })
        : t("newNote");
    else if (c.table === "report_edits") text = t("adjusted");
    return { at: c.at, userName: c.userName, text };
  });
  return [...access, ...changes].sort((a, b) => b.at.localeCompare(a.at));
}

// The call's log for leaders with audit.read: who opened and played it, and what was done with
// it. Loaded on request, since opening the log is not a view of the call itself.
export function CallLog({ callId }: { callId: string }) {
  const t = useTranslations("calls.log");
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setError(null);
    setBusy(true);
    try {
      setEntries(
        describe(await orgFetch<CallLogResponse>(`/calls/${callId}/log`), t),
      );
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Card
      title={t("title")}
      actions={
        <button
          type="button"
          className={secondaryButton}
          disabled={busy}
          onClick={load}
        >
          {entries ? t("refresh") : t("show")}
        </button>
      }
    >
      <ErrorMessage message={error} />
      {!entries ? (
        <p className="text-muted">{t("intro")}</p>
      ) : entries.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <ol className="divide-y divide-line">
          {entries.map((e, i) => (
            <li
              key={i}
              className="grid gap-x-4 py-2 sm:grid-cols-[10rem_minmax(0,1fr)]"
            >
              <span className="text-sm text-muted tabular-nums">
                {formatDateTime(e.at)}
              </span>
              <span className="[overflow-wrap:anywhere]">
                {e.text}
                {e.userName && (
                  <span className="text-muted"> · {e.userName}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
