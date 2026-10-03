import { describe, expect, it } from "vitest";
import { followUp } from "@/components/work/team-charts";
import { dayCount, formatPercent, previousPeriod, share, shortDay, type TeamSeller } from "./dashboard";

describe("periods to compare", () => {
  it("compares with the period of the same length right before", () => {
    expect(dayCount("2026-10-03", "2026-10-03")).toBe(1);
    expect(previousPeriod("2026-10-03", "2026-10-03")).toEqual({ from: "2026-10-02", to: "2026-10-02" });
    // A week from Monday to Sunday, and a month across the change to winter time.
    expect(previousPeriod("2026-09-28", "2026-10-04")).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(dayCount("2026-10-01", "2026-10-31")).toBe(31);
    expect(previousPeriod("2026-10-01", "2026-10-31")).toEqual({ from: "2026-08-31", to: "2026-09-30" });
  });
});

describe("who needs follow-up", () => {
  const seller = (name: string, over: Partial<TeamSeller>): TeamSeller => ({
    userId: name,
    name,
    calls: [0],
    sales: [0],
    red: [0],
    unreviewed: 0,
    feedback: 0,
    lastFeedbackAt: new Date().toISOString(),
    ...over,
  });
  const now = Date.parse("2026-10-03T12:00:00Z");

  it("lists the most pressing first: breaches and flags waiting for review before long without feedback", () => {
    const list = followUp(
      [
        seller("Anna", { calls: [10], red: [4] }),
        seller("Bo", { calls: [5], unreviewed: 2 }),
        seller("Cato", { calls: [8], lastFeedbackAt: "2026-08-01T10:00:00Z" }),
        seller("Dina", { calls: [9], red: [1] }),
        seller("Eli", { calls: [0], sales: [0] }),
      ],
      now,
    );
    expect(list.map((r) => r.seller.name)).toEqual(["Anna", "Bo", "Cato", "Eli"]);
    expect(list[0]!.reasons).toEqual([{ key: "breaches", values: { share: 40, red: 4, calls: 10 } }]);
    expect(list[1]!.reasons).toEqual([{ key: "unreviewed", values: { count: 2 } }]);
    expect(list[2]!.reasons).toEqual([{ key: "noFeedback30" }]);
    expect(list[3]!.reasons).toEqual([{ key: "inactive" }]);
  });
});

describe("numbers and days in the page's language", () => {
  it("writes shares and short days the Norwegian way outside a page", () => {
    expect(share(4, 10)).toBe(formatPercent(40));
    expect(formatPercent(40)).toBe("40\u00a0%");
    expect(share(1, 0)).toBe("–");
    expect(shortDay("2026-10-03")).toBe("3.10.");
  });
});
