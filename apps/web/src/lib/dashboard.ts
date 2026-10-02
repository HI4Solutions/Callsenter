// Dashboard and coaching (apps/api/src/org/dashboard.ts).

export type Scope = "me" | "seller" | "team" | "all";

export interface Dashboard {
  scope: Scope;
  target: string | null;
  targetName: string | null;
  from: string;
  to: string;
  canSeeAll: boolean;
  teams: { id: string; name: string }[];
  sales: {
    total: number;
    confirmed: number;
    pending: number;
    rejected: number;
    withdrawn: number;
    cancelled: number;
    revenueOnce: number;
    revenueMonthly: number;
  };
  calls: { total: number; durationMs: number; analyzed: number; green: number; yellow: number; red: number; unreviewed: number };
  complaints: { received: number; open: number };
  daily: { day: string; sales: number; confirmed: number; calls: number }[];
  sellers: { userId: string; name: string; sales: number; confirmed: number; calls: number; yellow: number; red: number; complaints: number }[];
  findings: { label: string; yellow: number; red: number }[];
}

export interface CoachingNote {
  id: string;
  sellerId: string;
  sellerName: string;
  authorId: string;
  authorName: string;
  callId: string | null;
  callTitle: string | null;
  callStartedAt: string | null;
  kind: "praise" | "improve";
  body: string;
  createdAt: string;
  readAt: string | null;
}

export const COACHING_KIND: Record<CoachingNote["kind"], string> = { praise: "Ros", improve: "Kan bli bedre" };

export const PERIODS = [
  { days: 7, label: "Siste 7 dager" },
  { days: 30, label: "Siste 30 dager" },
  { days: 90, label: "Siste 90 dager" },
  { days: 365, label: "Siste 12 måneder" },
] as const;

// The first day of a period of whole days ending today, in Norwegian time.
export function periodStart(days: number, now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date(now.getTime() - (days - 1) * 86_400_000));
}

export function share(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)} %` : "–";
}

export function canSeeDashboard(me: { modules?: string[] }): boolean {
  return (me.modules ?? []).includes("dashboard");
}
