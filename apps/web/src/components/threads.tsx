"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

interface ThreadSummary {
  id: string;
  subject: string;
  status: "open" | "closed";
  lastMessageAt: string;
  organizationId: string;
  organizationName: string;
  messages: number;
  unread: boolean;
}

interface ThreadDetail {
  id: string;
  subject: string;
  status: "open" | "closed";
  organizationName: string;
  messages: { id: string; body: string; fromPlatform: boolean; createdAt: string; mine: boolean; author: string }[];
}

// Conversations between a call centre's admins and VeriQall. base is "/org" (the call centre)
// or "/admin" (superadmin, across call centres).
export function Threads({ base, organizations }: { base: "/org" | "/admin"; organizations?: { id: string; name: string }[] }) {
  const t = useTranslations("threads");
  const tc = useTranslations("common");
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      apiFetch<ThreadSummary[]>(`${base}/threads`)
        .then(setThreads)
        .catch((e: Error) => setError(e.message)),
    [base],
  );

  useEffect(() => {
    let cancelled = false;
    apiFetch<ThreadSummary[]>(`${base}/threads`)
      .then((rows) => !cancelled && setThreads(rows))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [base]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="flex flex-col gap-3">
        <div>
          <button type="button" className={primaryButton} onClick={() => setSelected("new")}>
            {t("new")}
          </button>
        </div>
        <ErrorMessage message={error} />
        {!threads && !error && <p className="text-muted">{tc("loading")}</p>}
        {threads && threads.length === 0 && <p className="text-muted">{t("empty")}</p>}
        {threads && threads.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {threads.map((th) => (
              <li key={th.id}>
                <button
                  type="button"
                  aria-current={selected === th.id ? "true" : undefined}
                  className={`flex w-full flex-col gap-1 p-4 text-left ${selected === th.id ? "bg-bg" : "hover:bg-bg"}`}
                  onClick={() => setSelected(th.id)}
                >
                  <span className="flex items-center gap-2 font-semibold">
                    {th.unread && <span className="size-2 shrink-0 rounded-full bg-brand" aria-label={t("unread")} />}
                    {th.subject}
                  </span>
                  <span className="text-sm text-muted">
                    {base === "/admin" && `${th.organizationName} · `}
                    {t("messages", { count: th.messages })} · {formatDateTime(th.lastMessageAt)}
                    {th.status === "closed" && ` · ${t("closed")}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        {selected === "new" && (
          <NewThread
            base={base}
            organizations={organizations}
            onCreated={async (id) => {
              await reload();
              setSelected(id);
            }}
          />
        )}
        {selected && selected !== "new" && <Thread key={selected} base={base} id={selected} onChanged={reload} />}
        {!selected && <p className="text-muted">{t("choose")}</p>}
      </div>
    </div>
  );
}

function NewThread({
  base,
  organizations,
  onCreated,
}: {
  base: "/org" | "/admin";
  organizations?: { id: string; name: string }[];
  onCreated: (id: string) => Promise<void>;
}) {
  const t = useTranslations("threads");
  const [form, setForm] = useState({ organizationId: "", subject: "", body: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await apiFetch<{ id: string }>(`${base}/threads`, { method: "POST", body: form });
      await onCreated(created.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 sm:p-6">
      <h2 className="text-xl font-bold">{base === "/admin" ? t("newWithOrganization") : t("newWithVeriqall")}</h2>
      {base === "/admin" && (
        <Field label={t("organization")}>
          <select required className={inputClass} value={form.organizationId} onChange={(e) => setForm({ ...form, organizationId: e.target.value })}>
            <option value="">{t("chooseOrganization")}</option>
            {organizations?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label={t("subject")}>
        <input required maxLength={200} className={inputClass} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
      </Field>
      <Field label={t("message")}>
        <textarea
          required
          maxLength={5000}
          rows={5}
          className={`${inputClass} py-2`}
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
        />
      </Field>
      <ErrorMessage message={error} />
      <div>
        <button type="submit" className={primaryButton} disabled={busy}>
          {busy ? t("sending") : t("send")}
        </button>
      </div>
    </form>
  );
}

function Thread({ base, id, onChanged }: { base: "/org" | "/admin"; id: string; onChanged: () => Promise<void> }) {
  const t = useTranslations("threads");
  const tc = useTranslations("common");
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => apiFetch<ThreadDetail>(`${base}/threads/${id}`), [base, id]);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((detail) => {
        if (cancelled) return;
        setThread(detail);
        // Opening marks it read; refresh the list's unread dots.
        void onChanged();
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [load, onChanged]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`${base}/threads/${id}/messages`, { method: "POST", body: { body: text } });
      setText("");
      setThread(await load());
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus() {
    if (!thread) return;
    try {
      await apiFetch(`${base}/threads/${id}`, { method: "PATCH", body: { status: thread.status === "open" ? "closed" : "open" } });
      setThread(await load());
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!thread) return error ? <ErrorMessage message={error} /> : <p className="text-muted">{tc("loading")}</p>;
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{thread.subject}</h2>
          {base === "/admin" && <p className="text-sm text-muted">{thread.organizationName}</p>}
        </div>
        <button type="button" className={secondaryButton} onClick={toggleStatus}>
          {thread.status === "open" ? t("close") : t("reopen")}
        </button>
      </div>
      <ol className="flex flex-col gap-3">
        {thread.messages.map((m) => (
          <li key={m.id} className={`max-w-[85%] rounded-xl border border-line p-3 ${m.mine ? "self-end bg-bg" : "self-start"}`}>
            <p className="text-sm font-semibold">
              {m.author} <span className="font-normal text-muted">· {formatDateTime(m.createdAt)}</span>
            </p>
            <p className="mt-1 whitespace-pre-line break-words">{m.body}</p>
          </li>
        ))}
      </ol>
      <form onSubmit={send} className="flex flex-col gap-3">
        <Field label={t("reply")}>
          <textarea required maxLength={5000} rows={3} className={`${inputClass} py-2`} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <ErrorMessage message={error} />
        <div>
          <button type="submit" className={primaryButton} disabled={busy}>
            {busy ? t("sending") : t("sendReply")}
          </button>
        </div>
      </form>
    </div>
  );
}
