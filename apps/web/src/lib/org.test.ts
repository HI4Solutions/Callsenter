import { describe, expect, it } from "vitest";
import { memberState } from "./org";

describe("member state", () => {
  it("shows deactivated first, then invited, then active", () => {
    expect(memberState({ status: "disabled", userStatus: "active" }).label).toBe("Deaktivert");
    expect(memberState({ status: "active", userStatus: "invited" }).label).toBe("Invitert");
    expect(memberState({ status: "active", userStatus: "active" }).label).toBe("Aktiv");
  });
});
