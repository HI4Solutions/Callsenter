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
