"use client";

import { useState } from "react";
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
        className="inline-flex min-h-12 items-center justify-center rounded-lg border border-line bg-surface px-5 font-semibold disabled:opacity-60"
      >
        {busy ? "Venter på passkey …" : "Logg inn med passkey"}
      </button>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
