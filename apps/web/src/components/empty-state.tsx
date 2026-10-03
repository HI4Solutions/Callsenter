// An empty list: what is missing, and what to do next.
export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-dashed border-line bg-surface p-6">
      <p className="font-semibold">{title}</p>
      {children && <div className="text-muted">{children}</div>}
    </div>
  );
}
