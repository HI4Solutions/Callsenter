import type { Metadata } from "next";
import { PasskeyLogin } from "@/components/passkey-login";
import { BankIdButton, VippsButton } from "@/components/provider-buttons";
import { SignedInRedirect } from "@/components/signed-in-redirect";
import { loginErrorMessage, loginStartUrl, safeNext } from "@/lib/auth";

export const metadata: Metadata = { title: "Logg inn" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const error = loginErrorMessage(first(params.feil));
  const invite = first(params.invitasjon);
  // Only a path inside the app survives; anything else is dropped here (and again in the API).
  const next = safeNext(first(params.neste));

  return (
    <section className="mx-auto max-w-md">
      <SignedInRedirect next={next} skip={Boolean(error || invite)} />
      <h1 className="text-3xl font-extrabold tracking-tight">Logg inn</h1>
      <p className="mt-3 text-muted">
        {invite
          ? "Du er invitert til VeriQall. Logg inn for å ta imot invitasjonen."
          : "Logg inn med Vipps, BankID eller passkey."}
      </p>

      {error && (
        <p role="alert" className="mt-6 rounded-lg border border-line bg-surface p-4">
          {error}
        </p>
      )}

      <div className="mt-8 flex flex-col gap-3">
        {/* TODO before production: Vipps' official symbol (own designs are not allowed). */}
        <VippsButton href={loginStartUrl("vipps", { invite, next })}>Logg inn med Vipps</VippsButton>
        <BankIdButton href={loginStartUrl("bankid", { invite, next })}>Logg inn med BankID</BankIdButton>
        {!invite && <PasskeyLogin next={next} />}
      </div>
    </section>
  );
}
