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
  daily: { day: string; sales: number; confirmed: number; calls: number; green: number; yellow: number; red: number }[];
  // Hour by hour when the period is a single day; empty otherwise.
  hourly: { hour: number; calls: number; green: number; yellow: number; red: number }[];
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

export interface CoachingList {
  notes: CoachingNote[];
  canCoach: boolean;
}

export const COACHING_KIND: Record<CoachingNote["kind"], string> = { praise: "Ros", improve: "Kan bli bedre" };

export type PeriodKey =
  | "today"
  | "yesterday"
  | "this-week"
  | "last-week"
  | "this-month"
  | "last-month"
  | "last-30"
  | "last-90"
  | "this-year"
  | "custom";

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: "I dag",
  yesterday: "I går",
  "this-week": "Denne uken",
  "last-week": "Forrige uke",
  "this-month": "Denne måneden",
  "last-month": "Forrige måned",
  "last-30": "Siste 30 dager",
  "last-90": "Siste 90 dager",
  "this-year": "Hittil i år",
  custom: "Velg datoer",
};

// Today's date in Norway.
export function osloToday(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(now);
}

// Whole calendar days from a date (safe across daylight saving changes).
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// The first and last day of a period, both included, in Norwegian time. Weeks start on Monday.
export function periodRange(key: Exclude<PeriodKey, "custom">, now = new Date()): { from: string; to: string } {
  const today = osloToday(now);
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const month = today.slice(0, 8);
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "this-week":
      return { from: addDays(today, -weekday), to: today };
    case "last-week":
      return { from: addDays(today, -weekday - 7), to: addDays(today, -weekday - 1) };
    case "this-month":
      return { from: `${month}01`, to: today };
    case "last-month": {
      const end = addDays(`${month}01`, -1);
      return { from: `${end.slice(0, 8)}01`, to: end };
    }
    case "last-30":
      return { from: addDays(today, -29), to: today };
    case "last-90":
      return { from: addDays(today, -89), to: today };
    case "this-year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

// The first day of a period of whole days ending today, in Norwegian time.
export function periodStart(days: number, now = new Date()): string {
  return addDays(osloToday(now), -(days - 1));
}

export function share(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)} %` : "–";
}

export function canSeeDashboard(me: { modules?: string[] }): boolean {
  return (me.modules ?? []).includes("dashboard");
}

// The team's average per seller, without names (apps/api/src/org/dashboard.ts). Figures only
// when at least three were active in the team, so no colleague's numbers can be worked out.
export interface Benchmark {
  teamName: string;
  sellers: number;
  tooFew: boolean;
  perSeller: { calls: number; sales: number; confirmed: number; durationMs: number } | null;
  // Whole percent, or null when there was nothing to divide by.
  shares: { confirmed: number | null; green: number | null; red: number | null } | null;
}

// Each seller in a team (or the whole call centre) day by day, for leaders.
export interface TeamSeller {
  userId: string;
  name: string;
  // One number per day in `days`.
  calls: number[];
  sales: number[];
  red: number[];
  unreviewed: number;
  // Feedback given in the period, and the last feedback ever.
  feedback: number;
  lastFeedbackAt: string | null;
}

export interface TeamDashboard {
  from: string;
  to: string;
  team: string | null;
  days: string[];
  sellers: TeamSeller[];
}

// Number of days in a period, both ends included.
export function dayCount(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
}

// The period of the same length right before, to compare with.
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const days = dayCount(from, to);
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

export function sum(values: number[]): number {
  return values.reduce((total, v) => total + v, 0);
}
