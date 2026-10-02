"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { formatDate, formatDateTime } from "@/lib/format";
import { fetchMe, loginPathFor, type Me } from "@/lib/auth";
import {
  addPasskey,
  listPasskeys,
  type MyPasskey,
  passkeyErrorMessage,
  passkeysSupported,
  removePasskey,
  suggestedPasskeyName,
} from "@/lib/passkey";

const METHOD: Record<string, string> = { bankid: "BankID", vipps: "Vipps", passkey: "passkey" };

export default function AccountPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [passkeys, setPasskeys] = useState<MyPasskey[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => listPasskeys().then(setPasskeys), []);

  useEffect(() => {
    let cancelled = false;
    fetchMe().then(async (result) => {
      if (cancelled) return;
      if (result === "signed-out") {
        router.replace(loginPathFor("/konto"));
        return;
      }
      const user = result;
      setMe(user);
      if (user) {
        const list = await listPasskeys().catch((e: Error) => {
          setError(e.message);
          return [];
        });
        if (!cancelled) setPasskeys(list);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (me === undefined) return <p className="text-muted">Laster …</p>;
  if (me === null) {
    return (
      <section className="max-w-md">
        <h1 className="text-3xl font-extrabold tracking-tight">Min konto</h1>
        <p className="mt-4">Får ikke kontakt med serveren. Prøv igjen om litt.</p>
      </section>
    );
  }

  return (
    <section className="flex max-w-3xl flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Min konto</h1>
        <p className="mt-2 text-muted">
          {me.user.name} · innlogget med {METHOD[me.provider] ?? me.provider}
        </p>
      </div>
      <Passkeys me={me} passkeys={passkeys} onChanged={reload} />
      <ErrorMessage message={error} />
    </section>
  );
}

function Passkeys({ me, passkeys, onChanged }: { me: Me; passkeys: MyPasskey[]; onChanged: () => Promise<void> }) {
  const [name, setName] = useState(() => (typeof navigator === "undefined" ? "Passkey" : suggestedPasskeyName(navigator.userAgent)));
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canAdd = me.provider === "bankid";

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await addPasskey(name.trim() || "Passkey");
      await onChanged();
      setMessage("Passkeyen er lagt til. Neste gang kan du logge inn med den.");
    } catch (e) {
      setError(passkeyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(passkey: MyPasskey) {
    if (!window.confirm(`Fjerne passkeyen «${passkey.name}»?`)) return;
    setError(null);
    try {
      await removePasskey(passkey.id);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card title="Passkeys">
      <p className="text-muted">
        Med en passkey logger du inn med Face ID, Touch ID, Windows Hello eller en sikkerhetsnøkkel. Det gir samme tilgang som
        BankID, uten kostnad per innlogging.
      </p>

      {passkeys.length > 0 && (
        <ul className="mt-4 divide-y divide-line">
          {passkeys.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">{p.name}</p>
                <p className="text-sm text-muted">
                  Lagt til {formatDate(p.createdAt)} · sist brukt {formatDateTime(p.lastUsedAt)}
                </p>
              </div>
              <button type="button" className={secondaryButton} onClick={() => remove(p)}>
                Fjern
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6">
        {!passkeysSupported() ? (
          <p>Denne nettleseren støtter ikke passkeys.</p>
        ) : canAdd ? (
          <form onSubmit={add} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <Field label="Navn på passkeyen" hint="For eksempel enheten den ligger på.">
              <input maxLength={100} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <button type="submit" className={primaryButton} disabled={busy}>
              {busy ? "Venter på enheten …" : "Legg til passkey"}
            </button>
          </form>
        ) : (
          <p>
            For å legge til en passkey må du være logget inn med BankID. Logg ut og logg inn igjen med BankID, så kan du legge
            den til her.
          </p>
        )}
        <div className="mt-3">
          <ErrorMessage message={error} />
          {message && <p role="status">{message}</p>}
        </div>
      </div>
    </Card>
  );
}
