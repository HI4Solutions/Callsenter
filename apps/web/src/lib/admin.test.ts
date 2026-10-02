import { describe, expect, it } from "vitest";
import { announcementState, changedFields, cumulative, invitationState, organizationState, toCsv } from "./admin";

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
