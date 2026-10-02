import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, isPermission, PERMISSION_KEYS, STRONG_AUTH_PERMISSIONS } from "./permissions.ts";

describe("permission catalog", () => {
  it("recognises only catalog permissions", () => {
    expect(isPermission("audit.read")).toBe(true);
    expect(isPermission("superadmin")).toBe(false);
    expect(isPermission("toString")).toBe(false);
  });

  it("gives admin every permission and the other default roles a subset", () => {
    expect([...DEFAULT_ROLES.admin.permissions].sort()).toEqual([...PERMISSION_KEYS].sort());
    for (const role of Object.values(DEFAULT_ROLES)) {
      for (const permission of role.permissions) expect(isPermission(permission)).toBe(true);
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
    }
  });

  it("requires strong authentication only for catalog permissions", () => {
    for (const permission of STRONG_AUTH_PERMISSIONS) expect(isPermission(permission)).toBe(true);
  });
});

describe("strong authentication", () => {
  it("covers every administrative permission", () => {
    expect([...STRONG_AUTH_PERMISSIONS].sort()).toEqual(
      ["audit.read", "billing.read", "calls.read.all", "roles.manage", "users.manage"],
    );
  });
});
