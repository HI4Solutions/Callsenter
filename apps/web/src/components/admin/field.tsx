import { useTranslations } from "next-intl";

// Form building blocks for the portal.
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="text-sm text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "min-h-11 rounded-lg border border-line bg-surface px-3 text-fg focus-visible:outline-2 focus-visible:outline-brand";

export const primaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-5 font-semibold text-on-brand disabled:opacity-60";

export const secondaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-surface px-4 font-semibold disabled:opacity-60";

export function ErrorMessage({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-line bg-surface p-3">
      {message}
    </p>
  );
}

// While a page's data loads, or when it could not be loaded: the error with a way to try again.
export function LoadState({ error }: { error: string | null }) {
  const tc = useTranslations("common");
  const t = useTranslations("admin.shared");
  // A skeleton of a title and a card, so the page does not jump as much when it arrives.
  if (!error) {
    return (
      <div role="status" className="flex flex-col gap-6">
        <span className="sr-only">{tc("loading")}</span>
        <div
          aria-hidden="true"
          className="h-9 w-2/3 max-w-sm animate-pulse rounded-lg bg-line/60 motion-reduce:animate-none"
        />
        <div
          aria-hidden="true"
          className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 sm:p-6"
        >
          <div className="h-6 w-40 animate-pulse rounded bg-line/60 motion-reduce:animate-none" />
          <div className="h-4 w-full animate-pulse rounded bg-line/40 motion-reduce:animate-none" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-line/40 motion-reduce:animate-none" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-line/40 motion-reduce:animate-none" />
        </div>
      </div>
    );
  }
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg border border-line bg-surface p-4"
    >
      <p>{error}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={secondaryButton}
          onClick={() => window.location.reload()}
        >
          {tc("tryAgain")}
        </button>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => window.history.back()}
        >
          {t("back")}
        </button>
      </div>
    </div>
  );
}
