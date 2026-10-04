"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Arrow } from "@/components/landing/demo-link";
import { API_URL } from "@/lib/auth";

// A clear focus: the border and outline in the brand colour, with a soft glow around the field.
const inputClass =
  "min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base transition-[border-color,box-shadow] duration-200 placeholder:text-muted hover:border-[color-mix(in_srgb,var(--brand)_45%,var(--border))] focus:border-brand focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--brand)_18%,transparent)] focus-visible:outline-offset-0";

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

  if (state.status === "sent") return <Sent text={t("sent")} />;
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
          className="cta-glow inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand px-5 font-semibold text-on-brand disabled:opacity-60"
        >
          {state.status === "sending" ? t("sending") : t("send")}
          {state.status !== "sending" && <Arrow />}
        </button>
      </div>
    </form>
  );
}

// The thank-you, with a check mark that draws itself (globals.css, .sent-check). Takes the focus,
// so keyboard and screen reader users are not left where the form was.
function Sent({ text }: { text: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);
  return (
    <div ref={box} role="status" tabIndex={-1} className="sent-box flex items-center gap-4 rounded-xl border border-line bg-surface p-5 focus:outline-none">
      <svg aria-hidden viewBox="0 0 52 52" className="sent-check size-12 flex-none text-brand" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="26" cy="26" r="23" pathLength={1} />
        <path d="m15.5 27 7 7 14-15" pathLength={1} />
      </svg>
      <p className="text-lg">{text}</p>
    </div>
  );
}
