export type FlagLevel = "godkjent" | "avvik" | "brudd";

const labels: Record<FlagLevel, string> = {
  godkjent: "Godkjent",
  avvik: "Avvik",
  brudd: "Brudd",
};

// AI-flagg (grønn, gul, rød). Betydningen står også som tekst, så den ikke bare bæres av fargen.
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
