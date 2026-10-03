import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LanguagePicker } from "@/components/language-picker";
import { PasskeyLogin } from "@/components/passkey-login";
import { BankIdButton, VippsButton } from "@/components/provider-buttons";
import { SignedInRedirect } from "@/components/signed-in-redirect";
import { loginErrorCode, loginStartUrl, safeNext } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("login"))("title") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const t = await getTranslations("login");
  const params = await searchParams;
  const error = loginErrorCode(first(params.feil));
  const invite = first(params.invitasjon);
  // Only a path inside the app survives; anything else is dropped here (and again in the API).
  const next = safeNext(first(params.neste));

  return (
    <section className="mx-auto max-w-md">
      <SignedInRedirect next={next} skip={Boolean(error || invite)} />
      <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
      <p className="mt-3 text-muted">{invite ? t("invited") : t("intro")}</p>

      {error && (
        <p role="alert" className="mt-6 rounded-lg border border-line bg-surface p-4">
          {t(`errors.${error}`)}
        </p>
      )}

      <div className="mt-8 flex flex-col gap-3">
        {/* TODO before production: Vipps' official symbol (own designs are not allowed). */}
        <VippsButton href={loginStartUrl("vipps", { invite, next })}>{t("vipps")}</VippsButton>
        <BankIdButton href={loginStartUrl("bankid", { invite, next })}>{t("bankid")}</BankIdButton>
        {!invite && <PasskeyLogin next={next} />}
      </div>
      <LanguagePicker signedIn={false} className="mt-8 justify-center" />
    </section>
  );
}
