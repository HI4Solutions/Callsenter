"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { API_URL } from "@/lib/auth";

const inputClass = "min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base placeholder:text-muted";

type State = { status: "idle" | "sending" | "sent" } | { status: "failed"; message: string };

// The form at the bottom of the landing page (docs/plan.md, section 20). Posts to the API without
// a session; the request ends up under Superadmin → Meldinger, and superadmins get an e-mail.
export function ContactForm() {
  const t = useTranslations("landing.contact");
  const tc = useTranslations("common");
  const [state, setState] = useState<State>({ status: "idle" });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    if (!API_URL) {
      setState({ status: "failed", message: tc("noServer") });
      return;
    }
    setState({ status: "sending" });
    try {
      const res = await fetch(`${API_URL}/contact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setState({ status: "failed", message: data.error ?? t("failed") });
        return;
      }
      form.reset();
      setState({ status: "sent" });
    } catch {
      setState({ status: "failed", message: tc("noServer") });
    }
  }

  if (state.status === "sent") {
    return (
      <p role="status" className="rounded-xl border border-line bg-surface p-5 text-lg">
        {t("sent")}
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("name")}
          <input name="name" required maxLength={200} autoComplete="name" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("email")}
          <input name="email" type="email" required maxLength={320} autoComplete="email" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("phone")}
          <input name="phone" type="tel" maxLength={40} autoComplete="tel" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("company")}
          <input name="company" maxLength={200} autoComplete="organization" className={inputClass} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t("message")}
        <textarea name="message" required maxLength={4000} rows={5} className={`${inputClass} py-2`} />
      </label>
      {/* Never shown: a bot that fills it is ignored by the API. */}
      <div className="hidden" aria-hidden="true">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {state.status === "failed" && (
        <p role="alert" className="text-sm font-medium">
          {state.message}
        </p>
      )}
      <div>
        <button
          type="submit"
          disabled={state.status === "sending"}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-5 font-semibold text-on-brand disabled:opacity-60"
        >
          {state.status === "sending" ? t("sending") : t("send")}
        </button>
      </div>
    </form>
  );
}
