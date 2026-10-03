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
  if (!error) return <p className="text-muted">Laster …</p>;
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-line bg-surface p-4">
      <p>{error}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={secondaryButton} onClick={() => window.location.reload()}>
          Prøv igjen
        </button>
        <button type="button" className={secondaryButton} onClick={() => window.history.back()}>
          Tilbake
        </button>
      </div>
    </div>
  );
}
