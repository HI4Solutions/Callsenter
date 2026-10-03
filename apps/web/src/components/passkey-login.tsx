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
        className={`${LOGIN_BUTTON} bg-brand text-on-brand disabled:opacity-60`}
      >
        <LoginButtonContent icon={<FingerprintIcon />}>
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

// A fingerprint, the usual sign for passkeys (after Lucide's "fingerprint", ISC licence).
function FingerprintIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
      <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
      <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
      <path d="M2 12a10 10 0 0 1 18-6" />
      <path d="M2 16h.01" />
      <path d="M21.8 16c.2-2 .131-5.354 0-6" />
      <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
      <path d="M8.65 22c.21-.66.45-1.32.57-2" />
      <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
    </svg>
  );
}
