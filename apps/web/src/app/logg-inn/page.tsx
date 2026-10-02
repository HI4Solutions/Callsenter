import type { Metadata } from "next";
import { PasskeyLogin } from "@/components/passkey-login";
import { SignedInRedirect } from "@/components/signed-in-redirect";
import { loginErrorMessage, loginStartUrl } from "@/lib/auth";

export const metadata: Metadata = { title: "Logg inn" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const error = loginErrorMessage(first(params.feil));
  const invite = first(params.invitasjon);
  const next = first(params.neste);

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
        {/* TODO before production: Vipps' official login button (own designs are not allowed). */}
        <a
          href={loginStartUrl("vipps", { invite, next })}
          className="inline-flex min-h-12 items-center justify-center rounded-lg bg-brand px-5 font-semibold text-on-brand"
        >
          Logg inn med Vipps
        </a>
        <a
          href={loginStartUrl("bankid", { invite, next })}
          className="inline-flex min-h-12 items-center justify-center rounded-lg border border-line bg-surface px-5 font-semibold"
        >
          Logg inn med BankID
        </a>
        {!invite && <PasskeyLogin next={next} />}
      </div>
    </section>
  );
}
