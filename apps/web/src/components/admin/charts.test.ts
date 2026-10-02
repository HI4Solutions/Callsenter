import { describe, expect, it } from "vitest";
import { niceMax } from "./charts";

describe("chart axis", () => {
  it("gives whole-number steps for counts", () => {
    for (const max of [0, 1, 3, 5, 7, 13, 20, 37, 132, 420, 9_999]) {
      const top = niceMax(max);
      expect(top).toBeGreaterThanOrEqual(max);
      expect(Number.isInteger(top / 4)).toBe(true);
    }
    expect(niceMax(5)).toBe(8);
    expect(niceMax(132)).toBe(200);
    expect(niceMax(420)).toBe(500);
  });
});
