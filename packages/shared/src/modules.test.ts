import { describe, expect, it } from "vitest";
import { isModuleKey, MODULE_KEYS, MODULES } from "./modules.ts";

describe("module catalog", () => {
  it("has keys the database accepts and Norwegian names", () => {
    for (const key of MODULE_KEYS) {
      expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(MODULES[key].name.length).toBeGreaterThan(0);
    }
  });

  it("recognises only catalog modules", () => {
    expect(isModuleKey("transcription")).toBe(true);
    expect(isModuleKey("billing")).toBe(false);
    expect(isModuleKey("toString")).toBe(false);
  });
});
