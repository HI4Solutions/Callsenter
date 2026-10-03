"use client";

import { useState } from "react";
import {
  LOGIN_BUTTON,
  LoginButtonContent,
} from "@/components/provider-buttons";
import { loginWithPasskey, passkeyErrorMessage } from "@/lib/passkey";

// "Logg inn med passkey" on the login page. Not offered with an invitation link: a first login
// goes through BankID or Vipps so the account is linked.
export function PasskeyLogin({ next }: { next?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function login() {
    setBusy(true);
    setError(null);
    try {
      const location = await loginWithPasskey(next);
      // A full page load, so the header picks up the new session.
      window.location.href = location;
    } catch (e) {
      setError(passkeyErrorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={login}
        disabled={busy}
        className={`${LOGIN_BUTTON} border border-line bg-surface disabled:opacity-60`}
      >
        <LoginButtonContent icon={<KeyIcon />}>
          {busy ? "Venter på passkey …" : "Logg inn med passkey"}
        </LoginButtonContent>
      </button>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

function KeyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={22}
      height={22}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="15" r="4.5" />
      <path d="M11.2 11.8 20 3M16.5 6.5l2.5 2.5M14 9l2 2" />
    </svg>
  );
}
