import { describe, expect, it } from "vitest";
import { canMoveSale, isSaleStatus, SALE_STATUS_KEYS, SALE_TRANSITIONS } from "./sales.ts";

describe("sale statuses", () => {
  it("only moves to known statuses, and final statuses go nowhere", () => {
    for (const from of SALE_STATUS_KEYS) for (const to of SALE_TRANSITIONS[from]) expect(isSaleStatus(to)).toBe(true);
    for (const status of ["rejected", "withdrawn", "cancelled"] as const) expect(SALE_TRANSITIONS[status]).toEqual([]);
  });

  it("follows the standard run", () => {
    expect(canMoveSale("registered", "awaiting_confirmation")).toBe(true);
    expect(canMoveSale("awaiting_confirmation", "confirmed")).toBe(true);
    expect(canMoveSale("confirmed", "active")).toBe(true);
    expect(canMoveSale("active", "registered")).toBe(false);
    expect(canMoveSale("registered", "withdrawn")).toBe(false);
    expect(isSaleStatus("toString")).toBe(false);
  });
});
