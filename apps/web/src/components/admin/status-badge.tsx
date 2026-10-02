import type { FlagLevel } from "@/components/flag";

const levels: Record<"ok" | "warning" | "danger", FlagLevel> = {
  ok: "approved",
  warning: "deviation",
  danger: "violation",
};

// Status uses the reserved status colors (CLAUDE.md, "Farger"), always with the meaning in text.
export function StatusBadge({ tone, children }: { tone: "ok" | "warning" | "danger"; children: React.ReactNode }) {
  return (
    <span className="flag inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium" data-flag={levels[tone]}>
      {children}
    </span>
  );
}
