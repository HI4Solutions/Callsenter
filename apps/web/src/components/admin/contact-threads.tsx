"use client";

import { LOCALES } from "@veriqall/shared";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { StatusBadge } from "@/components/admin/status-badge";
import { adminFetch, type ContactThread, type ContactThreads, formatDateTime } from "@/lib/admin";

type Preview = { to: string; subject: string | null; html: string; replyTo?: string | null };

// Correspondence with the landing page's visitors (docs/plan.md, section 20): one thread per
// e-mail address, shown as a chat. What we write is sent as e-mail in VeriQall's design; their
// answers come back here when incoming e-mail is set up.
export function ContactThreadsView() {
  const t = useTranslations("admin.messages.contact");
  const tc = useTranslations("common");
  const [data, setData] = useState<ContactThreads | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      adminFetch<ContactThreads>("/contact-threads")
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e: Error) => setError(e.message)),
    [],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  const thread = data?.threads.find((x) => x.email === selected) ?? null;

  return (
    <Card title={t("title")}>
      <p className="text-sm text-muted">{data?.inboundEmail ? t("introInbound", { email: data.inboundEmail }) : t("intro")}</p>
      {data && !data.emailEnabled && <p className="mt-2 text-sm">{t("noEmail")}</p>}
      <ErrorMessage message={error} />
      {data === null ? (
        <p className="mt-4 text-muted">{tc("loading")}</p>
      ) : data.threads.length === 0 ? (
        <p className="mt-4 text-muted">{t("none")}</p>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <ul className={`flex flex-col gap-1 ${thread ? "hidden lg:flex" : ""}`} aria-label={t("title")}>
            {data.threads.map((x) => (
              <li key={x.email}>
                <button
                  type="button"
                  onClick={() => setSelected(x.email)}
                  aria-current={x.email === selected}
                  className={`flex w-full flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left ${x.email === selected ? "border-brand bg-bg" : "border-line hover:bg-bg"}`}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-semibold">{x.name ?? x.email}</span>
                    {x.unread > 0 && <StatusBadge tone="warning">{t("unread", { count: x.unread })}</StatusBadge>}
                  </span>
                  <span className="w-full truncate text-sm text-muted">{x.email}</span>
                  <span className="text-xs text-muted">{formatDateTime(x.lastAt)}</span>
                </button>
              </li>
            ))}
          </ul>
          {thread ? (
            <Thread
              thread={thread}
              emailEnabled={data.emailEnabled}
              onBack={() => setSelected(null)}
              onChanged={reload}
              onError={setError}
            />
          ) : (
            <p className="hidden text-muted lg:block">{t("choose")}</p>
          )}
        </div>
      )}
    </Card>
  );
}

function Thread({
  thread,
  emailEnabled,
  onBack,
  onChanged,
  onError,
}: {
  thread: ContactThread;
  emailEnabled: boolean;
  onBack: () => void;
  onChanged: () => Promise<unknown>;
  onError: (message: string | null) => void;
}) {
  const t = useTranslations("admin.messages.contact");
  const tc = useTranslations("common");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  async function act<T>(fn: () => Promise<T>) {
    setBusy(true);
    onError(null);
    try {
      return await fn();
    } catch (e) {
      onError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const showPreview = () =>
    act(async () => setPreview(await adminFetch<Preview>("/contact-threads/preview", { method: "POST", body: { email: thread.email, message: text } })));
  const send = () =>
    act(async () => {
      await adminFetch("/contact-threads/reply", { method: "POST", body: { email: thread.email, message: text } });
      setText("");
      setPreview(null);
      await onChanged();
    });
  const showSent = (id: string) => act(async () => setPreview(await adminFetch<Preview>(`/contact-messages/${id}/email`)));
  const setHandled = (handled: boolean) =>
    act(async () => {
      await adminFetch("/contact-threads/handled", { method: "POST", body: { email: thread.email, handled } });
      await onChanged();
    });

  const details = [
    thread.phone && `${t("phone")}: ${thread.phone}`,
    thread.company && `${t("company")}: ${thread.company}`,
    thread.locale && `${t("language")}: ${LOCALES[thread.locale as keyof typeof LOCALES]?.name ?? thread.locale}`,
  ].filter(Boolean);

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <button type="button" className="mb-1 text-sm font-semibold text-brand lg:hidden" onClick={onBack}>
            ← {t("allThreads")}
          </button>
          <h3 className="text-lg font-semibold [overflow-wrap:anywhere]">{thread.name ?? thread.email}</h3>
          <a href={`mailto:${thread.email}`} className="text-sm text-brand [overflow-wrap:anywhere]">
            {thread.email}
          </a>
          {details.length > 0 && <p className="text-sm text-muted">{details.join(" · ")}</p>}
        </div>
        <button type="button" className={secondaryButton} disabled={busy} onClick={() => setHandled(thread.unread > 0)}>
          {thread.unread > 0 ? t("markHandled") : t("reopen")}
        </button>
      </div>

      <ol className="flex flex-col gap-3">
        {thread.messages.map((m) => {
          const ours = m.kind === "reply";
          return (
            <li key={m.id} className={`flex flex-col ${ours ? "items-end" : "items-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2 ${ours ? "rounded-br-sm bg-brand text-on-brand" : "rounded-bl-sm border border-line bg-bg"}`}
              >
                {m.subject && m.kind === "email" && <p className="text-sm font-semibold">{m.subject}</p>}
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.body}</p>
              </div>
              <p className="mt-1 text-xs text-muted">
                {t(`kind.${m.kind}`)} · {ours && m.sentByName ? `${m.sentByName} · ` : ""}
                {formatDateTime(m.createdAt)}
                {ours && !m.sent && ` · ${t("notSent")}`}
                {ours && (
                  <>
                    {" · "}
                    <button type="button" className="font-semibold text-brand" onClick={() => showSent(m.id)}>
                      {t("showEmail")}
                    </button>
                  </>
                )}
              </p>
            </li>
          );
        })}
      </ol>

      {emailEnabled && (
        <form
          className="flex flex-col gap-2 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t("reply")}
            <textarea className={`${inputClass} min-h-28 py-2`} required maxLength={10000} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <p className="text-sm text-muted">{t("replyHint", { email: thread.email })}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={secondaryButton} disabled={busy || !text.trim()} onClick={() => void showPreview()}>
              {t("preview")}
            </button>
            <button type="submit" className={primaryButton} disabled={busy || !text.trim()}>
              {busy ? t("sending") : t("send")}
            </button>
          </div>
        </form>
      )}

      {preview && (
        <div className="rounded-xl border border-line">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
            <div className="min-w-0 text-sm">
              <p>
                <span className="text-muted">{t("to")}:</span> {preview.to}
                {preview.replyTo && (
                  <>
                    {" · "}
                    <span className="text-muted">{t("replyTo")}:</span> {preview.replyTo}
                  </>
                )}
              </p>
              <p className="font-semibold">{preview.subject}</p>
            </div>
            <button type="button" className={secondaryButton} onClick={() => setPreview(null)}>
              {tc("close")}
            </button>
          </div>
          {/* The e-mail exactly as it is sent, isolated from the page: no scripts, no links out. */}
          <iframe title={t("preview")} sandbox="" srcDoc={preview.html} className="h-[32rem] w-full rounded-b-xl bg-white" />
        </div>
      )}
    </section>
  );
}
