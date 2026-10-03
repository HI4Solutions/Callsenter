import { describe, expect, it } from "vitest";
import { announcementState, attention, changedFields, cumulative, invitationState, organizationState, type PlatformOverview, toCsv } from "./admin";

const now = new Date("2026-10-02T12:00:00Z");

describe("superadmin status helpers", () => {
  it("shows active, trial, expired trial and suspended", () => {
    expect(organizationState({ status: "active", trialEndsAt: null }, now)).toEqual({ label: "Aktiv", tone: "ok" });
    expect(organizationState({ status: "active", trialEndsAt: "2026-11-01T00:00:00Z" }, now).tone).toBe("warning");
    expect(organizationState({ status: "active", trialEndsAt: "2026-09-01T00:00:00Z" }, now)).toEqual({
      label: "Prøveperiode utløpt",
      tone: "danger",
    });
    expect(organizationState({ status: "suspended", trialEndsAt: null }, now).label).toBe("Suspendert");
  });

  it("describes invitations", () => {
    const future = "2026-10-05T00:00:00Z";
    expect(invitationState({ usedAt: null, revokedAt: null, expiresAt: future }, now)).toBe("Venter");
    expect(invitationState({ usedAt: now.toISOString(), revokedAt: null, expiresAt: future }, now)).toBe("Brukt");
    expect(invitationState({ usedAt: null, revokedAt: now.toISOString(), expiresAt: future }, now)).toBe("Trukket tilbake");
    expect(invitationState({ usedAt: null, revokedAt: null, expiresAt: "2026-10-01T00:00:00Z" }, now)).toBe("Utløpt");
  });
});

describe("CSV export", () => {
  it("uses semicolons, quotes where needed and guards against formulas", () => {
    const csv = toCsv(["Navn", "Telefon"], [["Ås; Øvre", "+4791234567"], ['Si "hei"', null], ["=SUM(A1)", 3]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual([
      "Navn;Telefon",
      '"Ås; Øvre";\'+4791234567',
      '"Si ""hei""";',
      "'=SUM(A1);3",
      "",
    ]);
  });
});

describe("audit diff", () => {
  it("lists changed fields and ignores updated_at", () => {
    expect(
      changedFields({ name: "A", note: null, updated_at: "1" }, { name: "B", note: null, updated_at: "2", status: "active" }),
    ).toEqual([
      { field: "name", before: "A", after: "B" },
      { field: "status", before: null, after: "active" },
    ]);
    expect(changedFields(null, { id: "x" })).toEqual([{ field: "id", before: null, after: "x" }]);
  });
});

describe("messages and growth helpers", () => {
  it("describes announcement state", () => {
    expect(announcementState({ active: false, startsAt: "2026-01-01", endsAt: null }, now).label).toBe("Av");
    expect(announcementState({ active: true, startsAt: "2026-01-01", endsAt: null }, now).label).toBe("Vises nå");
    expect(announcementState({ active: true, startsAt: "2026-01-01", endsAt: "2026-02-01" }, now).label).toBe("Utløpt");
    expect(announcementState({ active: true, startsAt: "2026-12-01", endsAt: null }, now).tone).toBe("warning");
  });

  it("builds running totals", () => {
    expect(cumulative(10, [1, 0, 3])).toEqual([11, 11, 14]);
  });
});

describe("the superadmin's overview", () => {
  const quiet: PlatformOverview = {
    today: "2026-10-03",
    organizations: { total: 2, open: 2, trial: 1, paying: 1, closed: 0, newThisMonth: 0, ending: [], mostActive: [], quiet: [] },
    users: { active: 5, invited: 0, disabled: 0, new30: 0, loggedInToday: 2, loggedIn7: 4 },
    logins: { today: 2, week: 9, byMethod: { bankid: 3, vipps: 6, passkey: 0 }, failed24h: 1, suspiciousIps: 0, blockedIps: 0 },
    calls: { today: 10, week: 50, month: 20, failed7: 0, recording: 1, processing: 0, stuck: 0, piecesWaiting: 0, oldestPieceAt: null },
    usage: { hours: 1, controls: 10, notes: 2 },
    support: { open: 1, unread: 0, announcements: 0 },
    days: [],
    money: { mrr: 1000, arr: 12000, revenue: 0, costs: 10, result: -10, outstanding: 0, overdue: 0, missed: 0, drafts: 0, scheduled: 0 },
  };
  const now = Date.parse("2026-10-03T12:00:00Z");

  it("has nothing to say when all is well", () => {
    expect(attention(quiet, now)).toEqual([]);
  });

  it("puts the worker first, then failed calls, logins, money and messages", () => {
    const busy: PlatformOverview = {
      ...quiet,
      calls: { ...quiet.calls, stuck: 1, piecesWaiting: 3, oldestPieceAt: "2026-10-03T11:48:00Z", failed7: 2 },
      logins: { ...quiet.logins, suspiciousIps: 1 },
      money: { ...quiet.money, missed: 2, overdue: 5000, drafts: 1 },
      support: { ...quiet.support, unread: 3 },
    };
    const items = attention(busy, now);
    expect(items.map((i) => i.key)).toEqual(["stuck", "pieces", "failed", "ips", "missed", "unread", "drafts"]);
    expect(items[0]!.text).toMatch(/^1 samtale har stått i behandling/);
    expect(items[1]!.text).toMatch(/^3 lydbiter venter på transkripsjon, den eldste i 12 minutter\./);
    expect(items[4]).toMatchObject({ text: "2 fakturaer med uteblitt betaling.", href: "/admin/okonomi/faktura" });
  });

  it("lets pieces wait a few minutes, and shows what is overdue when no payment was missed", () => {
    const items = attention(
      {
        ...quiet,
        calls: { ...quiet.calls, piecesWaiting: 2, oldestPieceAt: "2026-10-03T11:58:00Z" },
        money: { ...quiet.money, overdue: 12500 },
      },
      now,
    );
    expect(items.map((i) => i.key)).toEqual(["overdue"]);
    expect(items[0]!.text).toBe("12\u00a0500 kr er forfalt og ikke betalt.");
  });
});
