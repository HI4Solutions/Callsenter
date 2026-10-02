export type FlagLevel = "approved" | "deviation" | "violation";

const labels: Record<FlagLevel, string> = {
  approved: "Godkjent",
  deviation: "Avvik",
  violation: "Brudd",
};

// AI flag (green, yellow, red). The meaning is also written as text, so it is not carried by color alone.
export function Flag({ level, children }: { level: FlagLevel; children?: React.ReactNode }) {
  return (
    <span
      className="flag inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium"
      data-flag={level}
    >
      {children ?? labels[level]}
    </span>
  );
}
